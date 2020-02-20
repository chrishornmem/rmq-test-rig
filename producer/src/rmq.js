const logger = require('debug-level')('rmq-test-rig')
const amqp = require('amqp-connection-manager')
const EventEmitter = require('events')
const { uuid } = require('uuidv4')
const RMQ_RPC_TIMEOUT = process.env.RMQ_RPC_TIMEOUT || 10000
const RMQ_CONNECT_TIMEOUT = process.env.RMQ_CONNECT_TIMEOUT || 120 * 1000 // 2 mins
const RMQ_MESSAGE_TTL = process.env.RMQ_MESSAGE_TTL || 10000
const RMQ_HOST = process.env.RMQ_HOST || 'amqp://rabbitmq:5672'
let connection;

/**
 * @param {string} [host] default is process.env.RMQ_HOST || 'amqp://rabbitmq:5672'
 */
const connect = async (host = RMQ_HOST) => {
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
            logger.error('Disconnected.')
        })
    });

}

/**
 * @param {string} name Name of the exchange
 * @param {string} [type] 'direct', 'fanout' etc, default is 'direct'
 * @param {object} [options] amqp channel.assertExchange options object
 */
Exchange = function (name, type = 'direct', options = { durable: false }) {

    if (!name) throw new Error('Missing name parameter')
    if (type && typeof type !== 'string') throw "Missing or invalid type parameter, expecting string"
    if (options && typeof options !== 'object') throw "Missing or invalid options parameter, expecting object"

    this.name = name
    this.type = type
    this.options = options
}

Exchange.prototype.initializeExchange = async function () {

    if (!connection) throw "initializeExchange was called without a valid connection"

    let self = this;

    try {
        self.exchangeChannel = await connection.createChannel({
            json: true,
            async setup(channel) {
                // `channel` here is a regular amqplib `ConfirmChannel`.
                // Note that `this` here is the channelWrapper instance.
                return channel.assertExchange(self.name, self.type, self.options)
            }
        });
        self.directChannel = await connection.createChannel({
            json: true,
            async setup(channel) {
                const q = await channel.assertQueue('', { exclusive: true });
                this.context.responseEmitter = new EventEmitter()
                this.context.responseEmitter.setMaxListeners(0)
                this.context.q = q;
                channel.consume(
                    q.queue,
                    msg => {
                        self.directChannel.context.responseEmitter.emit(
                            msg.properties.correlationId,
                            JSON.parse(msg.content.toString('utf8'))
                        )
                    },
                    { noAck: true }
                )
            }
        });
        return true
    } catch (error) {
        throw new Error("Failed to initialize exchange")
    }
}

/**
 * @param {string} queue name of queue
 * @param {function} consumeHandler handler function to call when message arrives on queue
 * @param {string} [routingKey] optional routing key, defaults to queue name
 * @param {number} [prefetch] optional number of messages to prefetch, default is 1
 * @param {number} [messageTtl] optional time to live for messages on the queue, default is process.env.RMQ_MESSAGE_TTL || 10000
 */
Exchange.prototype.subscribe = async function (queue, consumeHandler, routingKey = queue, prefetch = 1, messageTtl = RMQ_MESSAGE_TTL ) {
    logger.info("/subscribe")

    if (typeof queue !== 'string') throw "Missing or invalid queue parameter, expecting string"
    if (typeof consumeHandler !== 'function') throw "Missing or invalid consumeHandler parameter, expecting function"
    if (typeof routingKey !== 'string') throw "Invalid routingKey parameter, expecting string"
    if (typeof prefetch !== 'number') throw "Invalid prefetch parameter, expecting number"
    if (typeof messageTtl !== 'number') throw "Invalid messageTtl parameter, expecting number"

    let self = this
    this.exchangeChannel.addSetup(function (channel) {
        return Promise.all([
            channel.assertQueue(queue, {messageTtl:messageTtl}),
            channel.bindQueue(queue, self.name, routingKey),
            channel.prefetch(prefetch),
            channel.consume(queue, consumeHandler)
        ])
    });
}

/**
 * @param {object} message message to ack
 */
Exchange.prototype.ack = function (message) {

    if (typeof message === 'undefined') throw "Missing message param"

    if (this.exchangeChannel) {
        return this.exchangeChannel.ack(message)
    }
}

/**
 * @param {string} routingKey optional routing key, defaults to queue name
 * @param {object} message message to send (JSON object)
 * @param {object} [options] amqplib options object for publish method
 */
Exchange.prototype.publish = async function (routingKey, message, options) {

    if (typeof routingKey !== 'string') throw "Missing or invalid routingKey parameter, expecting string"
    if (typeof message !== 'object') throw "Missing or invalid message parameter, expecting object"
    if (options && typeof options !== 'object') throw "Missing or invalid options parameter, expecting object"

    return this.exchangeChannel.publish(this.name, routingKey, message, options);
}

/**
 * @param {string} queue name of queue
 * @param {object} message message to send (JSON object)
 * @param {number} [timeout] time to wait for response in ms, default is process.env.RMQ_RPC_TIMEOUT || 10000
 */
Exchange.prototype.sendRPCMessage = async function (queue, message, timeout = RMQ_RPC_TIMEOUT) {

    if (typeof queue !== 'string') throw "Missing or invalid queue parameter, expecting string"
    if (typeof message !== 'object') throw "Missing or invalid message parameter, expecting object"
    if (typeof timeout !== 'number') throw "Missing or invalid timeout parameter, expecting number"

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
            }, timeout)

            self.directChannel.sendToQueue(queue, message, {
                correlationId,
                replyTo: q.queue
            })
        }
    })
}

/**
 * @param {object} message the original message to reply to
 * @param {object} reply JSON content of the reply messsage
 */
Exchange.prototype.replyToRPC = async function (message, reply) {
    if (typeof message !== 'object') throw "Missing or invalid message parameter, expecting object"
    if (typeof reply !== 'object') throw "Missing or invalid reply parameter, expecting object"

    let self = this;
    self.exchangeChannel.sendToQueue(message.properties.replyTo, reply, {
        correlationId: message.properties.correlationId
    });
    return
}

module.exports = {
    Exchange,
    connect
}
