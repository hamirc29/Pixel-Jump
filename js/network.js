class NetworkManager {
    constructor() {
        this.peer = null;
        this.conn = null;
        this.isHost = false;
        this.myId = null;
        this.friendId = null;
        this.connectionTimeout = null;

        this.onConnected = null;
        this.onData = null;
        this.onDisconnected = null;
        this.onError = null;
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
                if (this.onError) this.onError(err);
                reject(err);
            });
        });
    }

    async host() {
        this.isHost = true;
        const maxRetries = 3;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const code = this.generateCode();
                await this.init(code);
                return code;
            } catch (err) {
                // If the ID is taken, retry with a new code
                if (attempt < maxRetries - 1 && err.type === 'unavailable-id') {
                    if (this.peer) { this.peer.destroy(); this.peer = null; }
                    continue;
                }
                throw err;
            }
        }
    }

    async join(hostCode) {
        this.isHost = false;
        this.friendId = hostCode.toUpperCase();
        await this.init();
        this.conn = this.peer.connect(this.friendId, { reliable: true });
        this.setupConnection();

        // Timeout: if connection doesn't open within 10 seconds, fail gracefully
        this.connectionTimeout = setTimeout(() => {
            if (!this.conn || !this.conn.open) {
                const err = new Error("Connection timed out. The code may be invalid or the host is unreachable.");
                err.type = 'connection-timeout';
                console.error("Connection timeout:", err.message);
                if (this.onError) this.onError(err);
                this.disconnect();
            }
        }, 10000);
    }

    setupConnection() {
        this.conn.on('open', () => {
            // Clear any pending timeout since we connected successfully
            if (this.connectionTimeout) {
                clearTimeout(this.connectionTimeout);
                this.connectionTimeout = null;
            }
            if (this.onConnected) this.onConnected();
        });

        this.conn.on('data', (data) => {
            if (this.onData) this.onData(data);
        });

        this.conn.on('close', () => {
            this.conn = null;
            if (this.onDisconnected) this.onDisconnected();
        });

        this.conn.on('error', (err) => {
            console.error("Connection Error:", err);
            if (this.onError) this.onError(err);
        });
    }

    send(data) {
        if (this.conn && this.conn.open) {
            this.conn.send(data);
        }
    }

    disconnect() {
        if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
        }
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
