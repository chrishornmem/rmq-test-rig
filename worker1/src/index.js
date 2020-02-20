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
    return exchange.subscribe('rpc_queue', handleRPCMessage)
}).then(() => {
    timer = setInterval(addBinding, 1000)
}).catch((error) => {
    logger.error(error)
    logger.error("Failed to connect")
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
    logger.info("caught default route");
    // Just send the index.html for other files to support HTML5Mode
    res.sendFile('/' + public_folder + '/index.html', { root: __dirname });
});

// error handling middleware should be loaded after the loading the routes
if ('development' == app.get('env')) {
    app.use(errorHandler());
}
//const connection = amqp.connect([process.env.RMQ_HOST], {json:true});

let bindings = require('../binding/bindings.json');
let initialBindings = [];
for (let b of bindings) {
    initialBindings.push(b)
}

logger.info("bindings:")
logger.info(Array.isArray(bindings))

function handleMessage(params) {
    exchange.ack(params)
    const msg = JSON.parse(params.content.toString('utf8'));
    logger.info("got msg:" + JSON.stringify(msg))
    logger.info((initialBindings.includes(msg.key)).toString().toUpperCase())

}

function handleRPCMessage(params) {
    exchange.ack(params)
    const msg = JSON.parse(params.content.toString('utf8'));
    logger.info("got msg:" + JSON.stringify(msg))
    exchange.replyToRPC(params, {reply:'replying to RPC'})

}

async function addBinding() {
    const newKey = bindings.pop()
    if (newKey) {
        try {
            await exchange.subscribe(process.env.QUEUE, handleMessage, newKey)
        } catch (error) {
            if (newKey) {
                bindings.push(newKey)
            }
            logger.error("Channel not ready")
        }
    } else {
        clearInterval(timer)
    }
}

server.listen(theport);
logger.info("listening on port:" + theport)

module.exports = app;