var SocketPeer = require('socketpeer'),
    EventEmitter = require('events'),
    util = require('util'),
    KeyboardListener = require('./keyboard-listener'),
    GamepadListener = require('./gamepad-listener');

var LATENCY_POLLING_BUFFER_SIZE = 5,
    LATENCY_POLLING_INTERVAL = 1000;

var ProxyControlsClient = function (url) {
  EventEmitter.call(this);

  /** @type {SocketPeer} WebRTC connection. */
  this.peer = new SocketPeer({
    pairCode: 'my-room',
    socketFallback: true,
    url: url
  });

  /** @type {string:Listener} Listeners bound to document events. */
  this.listeners = [
    new KeyboardListener(),
    new GamepadListener()
  ];

  /** @type {string:boolean} Keyboard state, [key]->true. */
  this.keys = {};

  /** @type {Array<number>} Circular array of recent latency measurements. */
  this.recentLatency = [];

  this.initConnection();
  this.initListeners();
};

util.inherits(ProxyControlsClient, EventEmitter);

/**
 * Initializes SocketPeer connection with broker server, and begins listening
 * for peer connections.
 */
ProxyControlsClient.prototype.initConnection = function () {
  var peer = this.peer;

  console.log('init');
  peer.on('connect', function () {
    console.info('connect()');
    this.initLatencyPolling();
    this.listeners.forEach(function (listener) { listener.bind(); });
  }.bind(this));
  peer.on('connect_error', function () { console.error('connect_error()'); });
  peer.on('connect_timeout', function () { console.warn('connect_timeout()'); });
  peer.on('disconnect', function () { console.info('disconnect()'); });
  peer.on('upgrade', function () { console.info('upgrade()'); });
  peer.on('error', function () { console.error('error()'); });
  peer.on('data', function (data) {
    console.log('data(%s)', JSON.stringify(data, null, 2));
  });
  peer.on('close', function () {
    this.listeners.forEach(function (listener) { listener.unbind(); });
    console.info('close()');
  }.bind(this));
};

ProxyControlsClient.prototype.initLatencyPolling = function () {
  var index = 0;

  // Ping remote peer at regular intervals.
  setInterval(function () {
    this.peer.send({type: 'ping', timestamp: Date.now()});
  }.bind(this), LATENCY_POLLING_INTERVAL);

  // Record round trip time, as an estimate of 2*latency.
  this.peer.on('data', function (event) {
    if (event.type !== 'ping') return;
    this.recentLatency[index] = (Date.now() - event.timestamp) / 2;
    index = (index + 1) % LATENCY_POLLING_BUFFER_SIZE;
  }.bind(this));
};

/**
 * Binds to listener events, forwarding each to remote peer.
 */
ProxyControlsClient.prototype.initListeners = function () {
  var self = this;
  this.listeners.forEach(function (listener) {
    listener.on(listener.type, function (e) {
      self.peer.send(e);
      self.emit(listener.type, e);
      console.log('publish(%s)', JSON.stringify(e, null, 2));
    });
  });
};

ProxyControlsClient.prototype.isServerConnected = function () {
  return this.peer.socket.readyState === WebSocket.OPEN;
};

ProxyControlsClient.prototype.isPeerConnected = function () {
  return this.peer.peerConnected;
};

ProxyControlsClient.prototype.getPeerProtocol = function () {
  if (this.peer.rtcConnected) {
    return 'rtc';
  } else if (this.peer.socketConnected && this.peer.peerConnected) {
    return 'socket';
  }
  return null;
};

ProxyControlsClient.prototype.getPeerLatency = function () {
  if (!this.recentLatency.length) return NaN;
  var avgLatency = 0;
  for (var i = 0; i < this.recentLatency.length; i++) {
    avgLatency += this.recentLatency[i];
  }
  return Math.round(avgLatency / this.recentLatency.length);
};

module.exports = ProxyControlsClient;
