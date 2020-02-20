const logger = require('debug-level')('rmq-test-rig')
const amqp = require('amqp-connection-manager')
const EventEmitter = require('events')
const { uuid } = require('uuidv4')
const RMQ_REPLY_QUEUE = 'amq.rabbitmq.reply-to'
const RMQ_RPC_TIMEOUT = 10000
const RMQ_CONNECT_TIMEOUT = 120 * 1000 // 2 mins

let connection;

const connect = async (host) => {
    if (!host) throw new Error("Missing host param")
    return new Promise((resolve, reject) => {
        connection = amqp.connect([host], { json: true })

        let timer = setTimeout(() => {
            logger.error(`/connect - could not connect to RMQ network within ${RMQ_CONNECT_TIMEOUT / 1000}s`)
            reject({ success: false, message: `/connect - could not connect to RMQ network within ${RMQ_CONNECT_TIMEOUT / 1000}s` })
        }, RMQ_CONNECT_TIMEOUT)

        connection.on('connect', async function () {
            logger.info('Connected!')
            clearTimeout(timer)
            resolve({ success: true, message: "connected" })
        })
        connection.on('disconnect', function (params) {
            logger.info('Disconnected.')
            // reject({ success: false, message: "disconnected" })
        })
    });

}

/**
 * @param {string} name Name of the exchange
 * @param {string} type 'direct', 'fanout' etc
 * @param {object} options amqp channel.assertExchange options object
 */
Exchange = function (name, type = 'direct', options = { durable: false }) {

    // Ask the connection manager for a ChannelWrapper.  Specify a setup function to
    // run every time we reconnect to the broker.
    // Create a channel wrapper
    if (!name) throw new Error('Missing name parameter')

    this.name = name
    this.type = type
    this.options = options
    logger.info("new Exchange this.name:" + this.name)

}

Exchange.prototype.initialzeDirectRPC = async function () {
    let self = this;
    self.directChannel = await connection.createChannel({
        json: true,
        async setup(channel) {
            // channel.assertQueue('', { exclusive: true });
            const q = await channel.assertQueue('', { exclusive: true });
            this.context.q = q;
            logger.info("QUEUE IS")
            logger.info(q)
            channel.consume(
                q.queue,
                msg => {
                    console.log("got message:" + msg.properties.correlationId)
                    // self.directChannel.context.responseEmitter.emit(
                    //     msg.properties.correlationId,
                    //     JSON.parse(msg.content.toString('utf8'))
                    // )
                },
                { noAck: true }
            )
        }
    });
    return true;
}

Exchange.prototype.initializeExchange = async function () {
    let self = this;
    try {
        self.exchangeChannel = await connection.createChannel({
            json: true,
            setup: function (channel) {
                // `channel` here is a regular amqplib `ConfirmChannel`.
                // Note that `this` here is the channelWrapper instance.
                return channel.assertExchange(self.name, self.type, self.options)
            }
        });
        return true
    } catch (error) {
        throw new Error("Failed to initialize exchange")
    }
}

Exchange.prototype.subscribe = async function (queue, consumeHandler, routingKey = queue, prefetch = 1) {
    logger.info("/subscribe")
    let self = this
    this.exchangeChannel.addSetup(function (channel) {
        return Promise.all([
            channel.assertQueue(queue),
            channel.bindQueue(queue, self.name, routingKey),
            channel.prefetch(prefetch),
            channel.consume(queue, consumeHandler)
        ])
    });
}

Exchange.prototype.ack = function (message) {
    if (this.exchangeChannel) {
        return this.exchangeChannel.ack(message)
    }
}


Exchange.prototype.publish = async function (routingKey, message, options) {
    return this.exchangeChannel.publish(this.name, routingKey, message, options);
}

Exchange.prototype.sendRPCMessage = async function (message) {

    let self = this;

    return new Promise((resolve, reject) => {

        if (!self.directChannel ||
            !self.directChannel.context ||
            !self.directChannel.context.responseEmitter) {

            reject("Channel not initialized")

        } else {

            let timer

            const q = self.directChannel.context.q;
            const correlationId = uuid()

            self.directChannel.context.responseEmitter.once(correlationId, (response) => {
                clearTimeout(timer)
                resolve(response)
            })

            timer = setTimeout(() => {
                logger.error("/sendRPCMessage - response not received within 10s")
                reject("Message not received within required time")
            }, RMQ_RPC_TIMEOUT)

            self.directChannel.sendToQueue('rpc_queue', message, {
                correlationId,
                replyTo: q.queue
            })
        }
    })
}

Exchange.prototype.replyToRPC = async function (msg, reply) {
    let self = this;
    self.exchangeChannel.sendToQueue(msg.properties.replyTo, reply, {
        correlationId: msg.properties.correlationId
    });
    return
}


module.exports = {
    Exchange,
    connect
}
