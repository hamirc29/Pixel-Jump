class NetworkManager {
    constructor() {
        this.peer = null;
        this.conn = null;
        this.isHost = false;
        this.myId = null;
        this.friendId = null;

        this.onConnected = null;
        this.onData = null;
        this.onDisconnected = null;
    }

    generateCode() {
        const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    init(id = null) {
        return new Promise((resolve, reject) => {
            this.peer = new Peer(id, {
                debug: 2,
                config: {
                    'iceServers': [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' },
                        { urls: 'stun:stun2.l.google.com:19302' }
                    ]
                }
            });

            this.peer.on('open', (assignedId) => {
                this.myId = assignedId;
                resolve(assignedId);
            });

            this.peer.on('connection', (connection) => {
                // If we are hosting, accept the connection
                if (this.isHost && !this.conn) {
                    this.conn = connection;
                    this.setupConnection();
                } else {
                    // Reject additional connections
                    connection.on('open', () => connection.close());
                }
            });

            this.peer.on('error', (err) => {
                console.error("PeerJS Error:", err);
                reject(err);
            });
        });
    }

    async host() {
        this.isHost = true;
        const code = this.generateCode();
        await this.init(code);
        return code;
    }

    async join(hostCode) {
        this.isHost = false;
        this.friendId = hostCode.toUpperCase();
        await this.init();
        this.conn = this.peer.connect(this.friendId, { reliable: false });
        this.setupConnection();
    }

    setupConnection() {
        this.conn.on('open', () => {
            if (this.onConnected) this.onConnected();
        });

        this.conn.on('data', (data) => {
            if (this.onData) this.onData(data);
        });

        this.conn.on('close', () => {
            this.conn = null;
            if (this.onDisconnected) this.onDisconnected();
        });
    }

    send(data) {
        if (this.conn && this.conn.open) {
            this.conn.send(data);
        }
    }

    disconnect() {
        if (this.conn) {
            this.conn.close();
        }
        if (this.peer) {
            this.peer.destroy();
        }
        this.conn = null;
        this.peer = null;
    }
}

window.network = new NetworkManager();
