//require('dotenv').load();

const logger = require('debug-level')('rmq-test-rig')
const express = require('express');
const app = express();
const server = require('http').createServer(app);
const path = require('path');
const methodOverride = require('method-override');
const bodyParser = require('body-parser');
const errorHandler = require('errorhandler');

const { connect, Exchange } = require('./rmq')
let exchange, timer
connect(process.env.RMQ_HOST).then(() => {
    exchange = new Exchange('exchange')
    return exchange.initializeExchange()
}).then(() => {
    return exchange.subscribe('producer', handleProducerRPCMessage)
}).then(() => {
    setInterval(sendRPC, 1000);
    setInterval(publish, 2000);
}).catch((error) => {
    logger.error(error)
    logger.error("Failed to connect");
    process.exit(0)
});

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
    app.use(function (req, res, next) {
        const protocol = req.get('x-forwarded-proto');
        protocol == 'https' ? next() : res.redirect('https://' + req.hostname + req.url);
    });
}

app.get('/', function (req, res, next) {
    res.sendFile('/' + public_folder + '/index.html', { root: __dirname });
});

app.get('*', function (req, res) {
    res.sendFile('/' + public_folder + '/index.html', { root: __dirname });
});

app.get('/*', function (req, res, next) {
    debug("caught default route");
    // Just send the index.html for other files to support HTML5Mode
    res.sendFile('/' + public_folder + '/index.html', { root: __dirname });
});

// error handling middleware should be loaded after the loading the routes
if ('development' == app.get('env')) {
    app.use(errorHandler());
}

let count = 1;

let bindings = require('../binding/all.json')
let bindingIndex = 0;

const publish = function () {
    exchange.publish(bindings[bindingIndex], { msg: count, key: bindings[bindingIndex] })
        .then(() => {
            logger.info(`Message ${count} was sent using ${bindings[bindingIndex]}`);
            if (count === 3) count = 0;
            count++;
            bindingIndex++;
            if (bindingIndex === bindings.length) bindingIndex = 0;
        }).catch((err) =>  {
           logger.error("Message was rejected...  Boo!");
        });
}

const sendRPC = function () {
    exchange.sendRPCMessage('rpc_queue', { msg: count, key: "RPC" })
        .then(() => {
            logger.info(`Direct RPC Message ${count} was sent`);
            if (count === 3) count = 0;
            count++;
        }).catch((err) =>  {
            logger.error(err)
           logger.error("Message was rejected...  Boo!");
        });
}

function handleProducerRPCMessage(params) {
    exchange.ack(params)
    const msg = JSON.parse(params.content.toString('utf8'));
    logger.info("got msg:" + JSON.stringify(msg))
    exchange.replyToRPC(params, {reply:'replying from Producer'})

}

server.listen(theport);
logger.info("listening on port:" + theport)

module.exports = app;