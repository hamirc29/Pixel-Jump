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
        this.onStatus = null;
    }

    generateCode() {
        const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    getIceServers() {
        return [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            // Free TURN relay fallback for restrictive NATs
            {
                urls: 'turn:openrelay.metered.ca:80',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turn:openrelay.metered.ca:443',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turn:openrelay.metered.ca:443?transport=tcp',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            }
        ];
    }

    init(id = null) {
        return new Promise((resolve, reject) => {
            this.peer = new Peer(id, {
                debug: 2,
                config: {
                    'iceServers': this.getIceServers()
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

        const maxAttempts = 3;
        const attemptTimeout = 5000; // 5 seconds per attempt

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                await this.attemptConnect(attempt, attemptTimeout);
                return; // Connected successfully
            } catch (err) {
                if (attempt < maxAttempts) {
                    // Clean up failed connection before retrying
                    if (this.conn) {
                        try { this.conn.close(); } catch (e) { }
                        this.conn = null;
                    }
                    if (this.onStatus) this.onStatus(`RETRYING... (${attempt + 1}/${maxAttempts})`);
                } else {
                    // All attempts exhausted
                    const finalErr = new Error("Could not connect after " + maxAttempts + " attempts.");
                    finalErr.type = 'connection-timeout';
                    if (this.onError) this.onError(finalErr);
                    this.disconnect();
                }
            }
        }
    }

    attemptConnect(attempt, timeout) {
        return new Promise((resolve, reject) => {
            this.conn = this.peer.connect(this.friendId, { reliable: true });

            const timer = setTimeout(() => {
                reject(new Error(`Attempt ${attempt} timed out`));
            }, timeout);

            this.conn.on('open', () => {
                clearTimeout(timer);
                // Connection opened — set up remaining listeners
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
                if (this.onConnected) this.onConnected();
                resolve();
            });

            this.conn.on('error', (err) => {
                clearTimeout(timer);
                reject(err);
            });
        });
    }

    setupConnection() {
        // Used by host side when accepting incoming connections
        this.conn.on('open', () => {
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
            try { this.conn.close(); } catch (e) { }
        }
        if (this.peer) {
            this.peer.destroy();
        }
        this.conn = null;
        this.peer = null;
    }
}

window.network = new NetworkManager();
