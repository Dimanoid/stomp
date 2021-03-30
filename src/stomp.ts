// Converted to typescript by Dmitry Mukhin (https://github.com/Dimanoid)
// Generated by CoffeeScript 1.7.1
/*
   Stomp Over WebSocket http://www.jmesnil.net/stomp-websocket/doc/ | Apache License V2.0
   Copyright (C) 2010-2013 [Jeff Mesnil](http://jmesnil.net/)
   Copyright (C) 2012 [FuseSource, Inc.](http://fusesource.com)
 */

const Byte = {
    LF: '\x0A',
    NULL: '\x00'
};

const VERSIONS = {
    V1_0: '1.0',
    V1_1: '1.1',
    V1_2: '1.2',
    supportedVersions: '1.1,1.0'
};

// export interface StompMessage {
//     command: string;
//     headers: any;
//     body: string;
//     ack(headers?: any): void;
//     nack(headers?: any): void;
// }

export class StompFrame {

    command: string;
    body: string;
    headers: { [id: string]: string };
    ack?: (headers: { [id: string]: string }) => void;
    nack?: (headers: { [id: string]: string }) => void;

    static marshall(command: string, headers: { [id: string]: string }, body?: string): string {
        let frame;
        frame = new StompFrame(command, headers, body);
        return frame.toString() + Byte.NULL;
    }

    static unmarshall(datas: string): StompFrame[] {
        const ref = datas.split(RegExp('' + Byte.NULL + Byte.LF + '*'));
        const results = [];
        for (let i = 0; i < ref.length; i++) {
            const data = ref[i];
            if (data && data.length > 0) {
                results.push(StompFrame.unmarshallSingle(data));
            }
        }
        return results;
    }

    static unmarshallSingle(data: string): StompFrame {
        const divider = data.search(RegExp('' + Byte.LF + Byte.LF));
        const headerLines = data.substring(0, divider).split(Byte.LF);
        const command = headerLines.shift();
        const headers: { [id: string]: string } = {};
        
        const trim = (str: string) => str.replace(/^\s+|\s+$/g, '');
        const ref = headerLines.reverse();
        for (let i = 0; i < ref.length; i++) {
            const line = ref[i];
            const idx = line.indexOf(':');
            headers[trim(line.substring(0, idx))] = trim(line.substring(idx + 1));
        }
        let body = '';
        const start = divider + 2;
        if (headers['content-length']) {
            const len = parseInt(headers['content-length'], 0);
            body = ('' + data).substring(start, start + len);
        }
        else {
            let chr = null;
            for (let i = start, j = start, ref = data.length; start <= ref ? j < ref : j > ref; i = start <= ref ? ++j : --j) {
                chr = data.charAt(i);
                if (chr === Byte.NULL) {
                    break;
                }
                body += chr;
            }
        }
        return new StompFrame(command!, headers, body);
    }

    constructor(command: string, headers: { [id: string]: string }, body?: string) {
        this.command = command;
        this.headers = headers != null ? headers : {};
        this.body = body != null ? body : '';
    }

    toString(): string {
        const lines = [this.command];
        const skipContentLength = !this.headers['content-length'];
        if (skipContentLength) {
            delete this.headers['content-length'];
        }
        for (const name of Object.keys(this.headers)) {
            lines.push('' + name + ':' + this.headers[name]);
        }
        if (this.body && !skipContentLength) {
            lines.push('content-length:' + (this.sizeOfUTF8(this.body)));
        }
        lines.push(Byte.LF + this.body);
        return lines.join(Byte.LF);
    }

    sizeOfUTF8(s: string): number {
        if (s) {
            const match = encodeURI(s).match(/%..|./g);
            return match ? match.length : 0;
        }
        return 0;
    }

}

export class StompClient {
    ws: WebSocket;
    counter: number = 0;
    connected: boolean = false;
    heartbeat = {
        outgoing: 10000,
        incoming: 10000
    };
    maxWebSocketFrameSize = 16 * 1024;
    subscriptions: { [id: string]: (frame: StompFrame) => void } = {};

    pinger: any;
    ponger: any;

    headers: { [id: string]: string } = {};

    errorCallback?: (frame: StompFrame) => void;
    connectCallback?: (frame: StompFrame) => void;
    disconnectCallback?: (frame?: StompFrame) => void;

    serverActivity: number = 0;
    onreceive?: (frame: StompFrame) => void;
    onreceipt?: (frame: StompFrame) => void;

    debug?: (...args: any[]) => void;

    constructor(ws: WebSocket, callbacks?: {
        error?: (frame: StompFrame) => void,
        connect?: (frame: StompFrame) => void,
        disconnect?: (frame: StompFrame) => void,
        receive?: (frame: StompFrame) => void,
        receipt?: (frame: StompFrame) => void,
        debug?: (frame: StompFrame) => void,
    }) {
        this.ws = ws;
        this.ws.binaryType = 'arraybuffer';
        this.errorCallback = callbacks?.error;
        this.connectCallback = callbacks?.connect;
        this.disconnectCallback = callbacks?.connect;
        this.onreceive = callbacks?.receive;
        this.onreceipt = callbacks?.receipt;
        this.debug = callbacks?.debug;
    }

    private _D(...args: any[]): void {
        if (this.debug) {
            this.debug(...args);
        };
    }

    private _now(): number {
        if (Date.now) {
            return Date.now();
        }
        else {
            return new Date().valueOf();
        }
    }

    private _send(msg: string): void {
        if (this.ws) {
            if (this.ws.readyState == WebSocket.OPEN) {
                this.ws.send(msg);
            }
            else if (this.ws.readyState == WebSocket.CONNECTING) {
                setTimeout(() => this._send(msg), 100);
            }
        }
    }

    private _transmit(command: string, headers: { [id: string]: string }, body?: string): void {
        let out = StompFrame.marshall(command, headers, body);
        this._D('>>> ', out);
        while (true) {
            if (out.length > this.maxWebSocketFrameSize) {
                this._send(out.substring(0, this.maxWebSocketFrameSize));
                out = out.substring(this.maxWebSocketFrameSize);
                this._D('remaining = ', out.length);
            }
            else {
                return this._send(out);
            }
        }
    }

    private _setupHeartbeat(headers: { [id: string]: string }): void {
        if (headers.version !== VERSIONS.V1_1 && headers.version !== VERSIONS.V1_2) {
            return;
        }
        const hb = headers['heart-beat'].split(',');
        const serverOutgoing = hb[0];
        const serverIncoming = hb[1];

        if (this.heartbeat.outgoing !== 0 && +serverIncoming !== 0) {
            const ttl = Math.max(this.heartbeat.outgoing, +serverIncoming);
            this._D('send PING every ', ttl, 'ms');
            this.pinger = setInterval(() => {
                this._send(Byte.LF);
                this._D('>>> PING');
            }, ttl);
        }
        if (this.heartbeat.incoming !== 0 && +serverOutgoing !== 0) {
            const ttl = Math.max(this.heartbeat.incoming, +serverOutgoing);
            this._D('check PONG every ', ttl, 'ms');
            this.ponger = setInterval(() => {
                const delta = this._now() - this.serverActivity;
                if (delta > ttl * 2) {
                    this._D('did not receive server activity for the last', delta, 'ms');
                    this.ws.close();
                }
            }, ttl);
        }
    }

    connect (
        login: string,
        passcode: string,
        host: string,
    ) {
        this.headers['login'] = login;
        this.headers['passcode'] = passcode;
        this.headers['host'] = host;

        this._D('Opening Web Socket...');
        this.ws.onmessage = (evt) => {
            let data;
            if (typeof ArrayBuffer !== 'undefined' && evt.data instanceof ArrayBuffer) {
                const arr = new Uint8Array(evt.data);
                this._D('--- got data length:', arr.length);
                data = '';
                for (let i = 0; i < arr.length; i++) {
                    data = data + String.fromCharCode(arr[i]);
                }
            }
            else {
                data = evt.data;
            }

            this.serverActivity = this._now();
            if (data === Byte.LF) {
                this._D('<<< PONG');
                return;
            }
            this._D('<<< ' + data);
            const umData = StompFrame.unmarshall(data);
            for (let i = 0; i < umData.length; i++) {
                const frame = umData[i];
                switch (frame.command) {
                    case 'CONNECTED':
                        this._D('connected to server ', frame.headers.server);
                        this.connected = true;
                        this._setupHeartbeat(frame.headers);
                        if (this.connectCallback) {
                            this.connectCallback(frame);
                        }
                        break;
                    case 'MESSAGE':
                        const subscription = frame.headers.subscription;
                        const onreceive = this.subscriptions[subscription] || this.onreceive;
                        const messageID = frame.headers['message-id'];
                        frame.ack = (headers) => {
                            if (headers == null) {
                                headers = {};
                            }
                            this.ack(messageID, subscription, headers);
                        };
                        frame.nack = (headers) => {
                            if (headers == null) {
                                headers = {};
                            }
                            return this.nack(messageID, subscription, headers);
                        };
                        if (this.subscriptions[subscription]) {
                            this.subscriptions[subscription](frame);
                        }
                        if (onreceive) {
                            onreceive(frame);
                        }
                        if (!this.subscriptions[subscription] && !onreceive) {
                            this._D('Unhandled received MESSAGE:', frame);
                        }
                        break;
                    case 'RECEIPT':
                        if (this.onreceipt) {
                            this.onreceipt(frame);
                        }
                        break;
                    case 'ERROR':
                        this._D('ws.readyState:', this.ws.readyState);
                        if (this.errorCallback) {
                            this.errorCallback(frame);
                            this._D('after errorCallback ws.readyState:', this.ws.readyState);
                        }
                        break;
                    default:
                        this._D('Unhandled frame:', frame);
                }
                this._D('after switch ws.readyState:', this.ws.readyState);
            }
            this._D('after for ws.readyState:', this.ws.readyState);
        };

        this.ws.onclose = (...q) => {
            this._D('ws.onclose, ws.readyState:', this.ws.readyState, q);
            this._cleanUp();
            if (this.disconnectCallback) {
                this.disconnectCallback();
            }
        };

        this.ws.onopen = () => {
            this._D('Web Socket Opened...');
            this.headers['accept-version'] = VERSIONS.supportedVersions;
            this.headers['heart-beat'] = [this.heartbeat.outgoing, this.heartbeat.incoming].join(',');
            this._transmit('CONNECT', this.headers);
        };
    }

    disconnect(disconnectCallback: (frame?: StompFrame) => void, headers?: { [id: string]: string }) {
        this._D('disconnect, ws.readyState:', this.ws.readyState);
        this._transmit('DISCONNECT', headers || {});
        this.ws.onclose = null;
        this.ws.close();
        this._cleanUp();
        if (disconnectCallback) {
            disconnectCallback();
        }
    }

    private _cleanUp() {
        this.connected = false;
        if (this.pinger) {
            clearInterval(this.pinger);
        }
        if (this.ponger) {
            return clearInterval(this.ponger);
        }
    }

    send(destination: string, headers: { [id: string]: string }, body: string) {
        if (headers == null) {
            headers = {};
        }
        if (body == null) {
            body = '';
        }
        headers.destination = destination;
        return this._transmit('SEND', headers, body);
    }

    subscribe(destination: string, callback: (frame: StompFrame) => void, headers: { [id: string]: string }) {
        if (headers == null) {
            headers = {};
        }
        if (!headers.id) {
            headers.id = 'sub-' + this.counter++;
        }
        headers.destination = destination;
        this.subscriptions[headers.id] = callback;
        this._transmit('SUBSCRIBE', headers);
        return {
            id: headers.id,
            unsubscribe: () => this.unsubscribe(headers.id)
        };
    }

    unsubscribe(id: string): void {
        delete this.subscriptions[id];
        this._transmit('UNSUBSCRIBE', { id });
    }

    begin(transaction: string) {
        const txid = transaction || 'tx-' + this.counter++;
        this._transmit('BEGIN', {
            transaction: txid
        });
        return {
            id: txid,
            commit: () => this.commit(txid),
            abort: () => this.abort(txid)
        };
    }

    commit(transaction: string): void {
        return this._transmit('COMMIT', { transaction });
    }

    abort(transaction: string): void {
        this._transmit('ABORT', { transaction });
    }

    ack(messageID: string, subscription: string, headers: { [id: string]: string }): void {
        if (headers == null) {
            headers = {};
        }
        headers['message-id'] = messageID;
        headers.subscription = subscription;
        return this._transmit('ACK', headers);
    }

    nack(messageID: string, subscription: string, headers: { [id: string]: string }): void {
        if (headers == null) {
            headers = {};
        }
        headers['message-id'] = messageID;
        headers.subscription = subscription;
        return this._transmit('NACK', headers);
    }
}
