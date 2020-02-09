//require('dotenv').load();

const logger = require('debug-level')('rmq-test-rig')
const express = require('express');
const app = express();
const server = require('http').createServer(app);
const path = require('path');
const methodOverride = require('method-override');
const bodyParser = require('body-parser');
const errorHandler = require('errorhandler');
// const rmq = require('./rmq.js');
// const exchange = new Exchange('exchange', 'direct')
// rmq.connect(process.env.RMQ_HOST)
const amqp = require('amqp-connection-manager')
const connection = amqp.connect([process.env.RMQ_HOST], {json:true});

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
    debug("caught default route");
    // Just send the index.html for other files to support HTML5Mode
    res.sendFile('/' + public_folder + '/index.html', { root: __dirname });
});

// error handling middleware should be loaded after the loading the routes
if ('development' == app.get('env')) {
    app.use(errorHandler());
}

// Ask the connection manager for a ChannelWrapper.  Specify a setup function to
// run every time we reconnect to the broker.
let channelWrapper = connection.createChannel({
    json: true,
    setup: function(channel) {
        // `channel` here is a regular amqplib `ConfirmChannel`.
        // Note that `this` here is the channelWrapper instance.
        return channel.assertQueue('rxQueueName', {durable: true});
    }
});

let publishChannel = connection.createChannel({
    json: true,
    setup: function(channel) {
        // `channel` here is a regular amqplib `ConfirmChannel`.
        // Note that `this` here is the channelWrapper instance.
        return channel.assertExchange('exchange', 'direct', { durable: false })
    }
});


// Send some messages to the queue.  If we're not currently connected, these will be queued up in memory
// until we connect.  Note that `sendToQueue()` and `publish()` return a Promise which is fulfilled or rejected
// when the message is actually sent (or not sent.)

const send = function() {
    channelWrapper.sendToQueue('rxQueueName', {hello: 'world'})
    .then(function() {
        return logger.info("Message was sent!  Hooray!");
    }).catch(function(err) {
        return logger.info("Message was rejected...  Boo!");
    });
}

let count = 1;

const publish = function() {
    publishChannel.publish('exchange',`key.${count}`, {hello: `world: ${count}`})
    .then(function() {
        if (count === 3) count = 0;
        count++;
        return logger.info(`Message ${count} was sent!  Hooray!`);
    }).catch(function(err) {
        return logger.info("Message was rejected...  Boo!");
    });
}

//publish()
setInterval(publish, 1000);

// async function sendMsg(message) {
//     try {
//         let ch = await exchange.createChannel('channel')
//         logger.info("ch:");
//         logger.info(ch)
//         const channel = new rmq.Channel(ch);
//         await channel.produce('testqueue',message)
//     } catch (error) {
//         logger.error(error)
//     }

//     // await exchange.sendRPCMessage(message)
// }

// let rmqMessage = {
//     sub: 'sub',
//     id: 1234,  // needs sanitizing
//     isGuest: false,
// }

// setTimeout(function() {
//     sendMsg(rmqMessage);
// },5000);

server.listen(theport);
logger.info("listening on port:" + theport)

module.exports = app;