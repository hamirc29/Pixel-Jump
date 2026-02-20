class NetworkManager {
    constructor() {
        this.peer = null;
        this.conn = null;
        this.isHost = false;
        this.myId = null;
        this.friendId = null;
        this.connectionTimeout = null;

        // Heartbeat state
        this.heartbeatInterval = null;
        this.watchdogTimeout = null;
        this.lastHeartbeat = 0;

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
            // Increased debug to 3 for deep troubleshooting
            this.peer = new Peer(id, {
                debug: 3,
                config: {
                    'iceServers': this.getIceServers()
                }
            });

            this.peer.on('open', (assignedId) => {
                console.log("PeerJS: Signaling channel open. ID:", assignedId);
                this.myId = assignedId;
                resolve(assignedId);
            });

            this.peer.on('connection', (connection) => {
                console.log("PeerJS: Incoming connection from", connection.peer);
                if (this.isHost && !this.conn) {
                    this.conn = connection;
                    this.setupConnection();
                } else {
                    console.log("PeerJS: Rejecting connection (already connected or not host)");
                    connection.on('open', () => connection.close());
                }
            });

            this.peer.on('error', (err) => {
                console.error("PeerJS: Global Error:", err);
                if (this.onError) this.onError(err);
                reject(err);
            });

            this.peer.on('disconnected', () => {
                console.log("PeerJS: Disconnected from signaling server.");
                // Attempt to reconnect to signaling server
                this.peer.reconnect();
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
                if (attempt < maxRetries - 1 && err.type === 'unavailable-id') {
                    console.log("PeerJS: Code collision, retrying...");
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
        const attemptTimeout = 7000; // Slightly longer for ICE negotiation

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                console.log(`PeerJS: Connection attempt ${attempt}/${maxAttempts}...`);
                await this.attemptConnect(attempt, attemptTimeout);
                return;
            } catch (err) {
                console.warn(`PeerJS: Attempt ${attempt} failed:`, err);
                if (attempt < maxAttempts) {
                    if (this.conn) {
                        try { this.conn.close(); } catch (e) { }
                        this.conn = null;
                    }
                    if (this.onStatus) this.onStatus(`RETRYING... (${attempt + 1}/${maxAttempts})`);
                    // Small delay before retry to let sockets settle
                    await new Promise(r => setTimeout(r, 1000));
                } else {
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
            this.conn = this.peer.connect(this.friendId, {
                reliable: true,
                metadata: { attempt: attempt }
            });

            const timer = setTimeout(() => {
                reject(new Error(`Attempt ${attempt} timed out`));
            }, timeout);

            // Register handlers IMMEDIATELY, don't wait for 'open'
            this.conn.on('data', (data) => {
                this.resetWatchdog();
                if (data.type === 'ping') {
                    // Internal heartbeat, don't pass to app
                    return;
                }
                if (this.onData) this.onData(data);
            });

            this.conn.on('open', () => {
                clearTimeout(timer);
                console.log("PeerJS: Data channel open with", this.conn.peer);

                this.startHeartbeat();
                this.setupConnectionHandlers();

                if (this.onConnected) this.onConnected();
                resolve();
            });

            this.conn.on('error', (err) => {
                clearTimeout(timer);
                reject(err);
            });

            this.conn.on('close', () => {
                console.log("PeerJS: Connection closed during handshake");
                reject(new Error("Connection closed during handshake"));
            });
        });
    }

    setupConnection() {
        // Immediate data handling for host side too
        this.conn.on('data', (data) => {
            this.resetWatchdog();
            if (data.type === 'ping') return;
            if (this.onData) this.onData(data);
        });

        this.conn.on('open', () => {
            console.log("PeerJS: Connection accepted and open");
            this.startHeartbeat();
            this.setupConnectionHandlers();
            if (this.onConnected) this.onConnected();
        });

        this.conn.on('error', (err) => {
            console.error("PeerJS: Connection Error:", err);
            if (this.onError) this.onError(err);
        });

        this.conn.on('close', () => {
            console.log("PeerJS: Connection closed");
            this.stopHeartbeat();
            if (this.onDisconnected) this.onDisconnected();
        });
    }

    setupConnectionHandlers() {
        // Additional listeners for a fully established connection
        this.conn.on('error', (err) => {
            console.error("PeerJS: Live Connection Error:", err);
            if (this.onError) this.onError(err);
        });

        this.conn.on('close', () => {
            this.stopHeartbeat();
            if (this.onDisconnected) this.onDisconnected();
        });
    }

    startHeartbeat() {
        this.stopHeartbeat();
        this.lastHeartbeat = Date.now();

        // PING every 2 seconds
        this.heartbeatInterval = setInterval(() => {
            this.send({ type: 'ping' });
        }, 2000);

        // WATCHDOG: If no packet (ping or data) for 7 seconds, assume dead
        this.resetWatchdog();
    }

    resetWatchdog() {
        if (this.watchdogTimeout) clearTimeout(this.watchdogTimeout);
        this.watchdogTimeout = setTimeout(() => {
            console.warn("PeerJS: Connection timed out (Watchdog)");
            this.disconnect();
            if (this.onError) {
                const err = new Error("Connection lost (Timeout)");
                err.type = "connection-timeout";
                this.onError(err);
            }
        }, 8000);
    }

    stopHeartbeat() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        if (this.watchdogTimeout) clearTimeout(this.watchdogTimeout);
        this.heartbeatInterval = null;
        this.watchdogTimeout = null;
    }

    send(data) {
        if (this.conn && this.conn.open) {
            try {
                this.conn.send(data);
            } catch (e) {
                console.error("PeerJS: Send failed", e);
            }
        }
    }

    disconnect() {
        console.log("PeerJS: Performing full cleanup...");
        this.stopHeartbeat();
        if (this.conn) {
            try { this.conn.close(); } catch (e) { }
        }
        if (this.peer) {
            try { this.peer.destroy(); } catch (e) { }
        }
        this.conn = null;
        this.peer = null;
    }
}

window.network = new NetworkManager();
