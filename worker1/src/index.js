//require('dotenv').load();

const logger = require('debug-level')('rmq-test-rig')
const express = require('express');
const app = express();
const server = require('http').createServer(app);
const path = require('path');
const methodOverride = require('method-override');
const bodyParser = require('body-parser');
const errorHandler = require('errorhandler');
// const Exchange = require('./rmq.js').Exchange
// const exchange = new Exchange(process.env.RMQ_HOST, 'exchange', 'direct')
// exchange.initialize()

const amqp = require('amqp-connection-manager')

// Bring in the routes for the API (delete the default routes)

// The http server will listen to an appropriate port, or default to
// port 5000xxxx.

const theport = process.env.PORT || 5000;
let mode = app.get('env');
mode = mode.toLowerCase();
const public_folder = mode == 'production' ? 'public' : 'app_client';

logger.info("public_folder:" + public_folder);

// compress all responses
app.use(methodOverride());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

if (process.env.NODE_ENV === 'production') {
    // app.set('trust proxy', 1); // trust first proxy
    sessionConfig.cookie = { secure: true }; // serve secure cookies
}

app.use(express.static(path.join(__dirname, public_folder)));

// Force HTTPS on Heroku
// if (app.get('env') === 'production') {
if (process.env.HTTPS === 'ON') {
    app.use(function(req, res, next) {
        const protocol = req.get('x-forwarded-proto');
        protocol == 'https' ? next() : res.redirect('https://' + req.hostname + req.url);
    });
}

app.get('/', function(req, res, next) {
    res.sendFile('/' + public_folder + '/index.html', { root: __dirname });
});

app.get('*', function(req, res) {
    res.sendFile('/' + public_folder + '/index.html', { root: __dirname });
});

app.get('/*', function(req, res, next) {
    logger.info("caught default route");
    // Just send the index.html for other files to support HTML5Mode
    res.sendFile('/' + public_folder + '/index.html', { root: __dirname });
});

// error handling middleware should be loaded after the loading the routes
if ('development' == app.get('env')) {
    app.use(errorHandler());
}
const connection = amqp.connect([process.env.RMQ_HOST], {json:true});

let bindings = require('../binding/bindings.json');
let initialBindings = [];
for (let b of bindings) {
    initialBindings.push(b)
}
let channelWrapper

logger.info("bindings:")
logger.info(Array.isArray(bindings))

function handleMessage(params) {
    channelWrapper.ack(params)
    const msg = JSON.parse(params.content.toString('utf8'));
    logger.info("got msg:"+JSON.stringify(msg))
    logger.info((initialBindings.includes(msg.key)).toString().toUpperCase())
}

// Ask the connection manager for a ChannelWrapper.  Specify a setup function to
// run every time we reconnect to the broker.
channelWrapper = connection.createChannel({
    json: true,
    setup: function(channel) {
        // `channel` here is a regular amqplib `ConfirmChannel`.
        // Note that `this` here is the channelWrapper instance.
        return Promise.all([
            channel.assertExchange('exchange', 'direct', { durable: false }),
            channel.assertQueue(process.env.QUEUE),
            channel.bindQueue(process.env.QUEUE, 'exchange', process.env.ROUTING_KEY),
            channel.prefetch(100),
            channel.consume(process.env.QUEUE, handleMessage)])
    }
});

// channelWrapper.addSetup(function(channel) {
//     return Promise.all([
//         channel.assertQueue('WORKER'),
//         channel.bindQueue('WORKER', 'exchange', 'KEY-1'),
//         channel.prefetch(1),
//         channel.consume('WORKER', handleMessage)
//     ]);
// });

// Send some messages to the queue.  If we're not currently connected, these will be queued up in memory
// until we connect.  Note that `sendToQueue()` and `publish()` return a Promise which is fulfilled or rejected
// when the message is actually sent (or not sent.)
// channelWrapper.sendToQueue('rxQueueName', {hello: 'world'})
// .then(function() {
//     return logger.info("Message was sent!  Hooray!");
// }).catch(function(err) {
//     return logger.info("Message was rejected...  Boo!");
// });

// setTimeout(function() {
//     exchange.consume('exchange');
// },5000);

function addBinding() {
    if (channelWrapper) {
        const newKey = bindings.pop()
        if (newKey) {
            channelWrapper.addSetup(function(channel) {
                logger.info("binding to key: "+ newKey)                
                channel.bindQueue(process.env.QUEUE, 'exchange', newKey)
            });
        } else {
            clearInterval(timer)
        }
    }
}

let timer = setInterval(addBinding,5)

server.listen(theport);
logger.info("listening on port:" + theport)

module.exports = app;