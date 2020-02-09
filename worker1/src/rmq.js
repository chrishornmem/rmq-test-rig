const logger = require('debug-level')('rmq-test-rig')
const amqp = require('amqp-connection-manager')
const EventEmitter = require('events')
const uuid = require('uuidv4')
const REPLY_QUEUE = 'amq.rabbitmq.reply-to'


/**
 * @param {string} name Name of the exchange
 * @param {string} type 'direct', 'fanout' etc
 */
Exchange = function (rmqHost, name, type) {

    // Ask the connection manager for a ChannelWrapper.  Specify a setup function to
    // run every time we reconnect to the broker.
    // Create a channel wrapper
    this.name = name
    this.type = type
    this.rmqHost = rmqHost
}

Exchange.prototype.initialize = async function (rmqHost) {
    // Automatically connect to a Rabbit host when this module is required
    try {
        let self = this

        self.connection = amqp.connect([self.rmqHost], { json: true })
        self.connection.on('connect', async function () {
            logger.info('Connected!')
        })
        self.connection.on('disconnect', function (params) {
            logger.info('Disconnected.', params.err.stack)
        })
        self.channelWrapper = this.connection.createChannel({
            json: true,
            setup: channel => {
                channel.assertExchange(self.name, self.type)
                this.channelWrapper.context.responseEmitter = new EventEmitter()
                this.channelWrapper.context.responseEmitter.setMaxListeners(0)
                channel.consume(
                    REPLY_QUEUE,
                    msg => {
                        this.channelWrapper.context.responseEmitter.emit(
                            msg.properties.correlationId,
                            JSON.parse(msg.content.toString('utf8'))
                        )
                    },
                    { noAck: true }
                )
            }
        })

    } catch (error) {
        logger.error(error)
        throw error
    }
}


Exchange.prototype.publish = async function (routingKey, message, persistent = true) {
    try {
        let self = this

        logger.info("publishing to queue:")
        logger.info(this.name)
        logger.info(routingKey)
        logger.info(message)

        self.channelWrapper.publish(this.name, routingKey, message, { contentType: 'application/json', persistent })

        return Promise.resolve(true)

    } catch (error) {
        logger.error(error)
        return Promise.reject(error)
    }
}

Exchange.prototype.sendRPCMessage = function (message) {
    logger.info("/sendRPCMessage")
    logger.info(message)

    return new Promise((resolve, reject) => {
        const correlationId = uuid()
        let self = this
        let timer

        self.channelWrapper.context.responseEmitter.once(correlationId, (response) => {
            clearTimeout(timer)
            resolve(response)
        })

        timer = setTimeout(() => {
            logger.error("/sendRPCMessage - response not received within 10s")
            reject("Message not received within required time")
        }, 10000)

        self.channelWrapper.sendToQueue(self.name, message, {
            correlationId,
            replyTo: REPLY_QUEUE,
            contentType: 'application/json'
        })
    })
}


// Consumer
Exchange.prototype.consume = function (queue) {

    let self = this

    var ok = self.connection.createChannel(on_open)
    function on_open(err, ch) {
        if (err != null) throw err
        ch.assertQueue(queue)
        ch.consume(queue, function (msg) {
            if (msg !== null) {
                console.log(msg.content.toString())
                ch.ack(msg)
            }
        })
    }
}

Exchange.prototype.createQueue = async (queue) => {
    logger.info("/createQueue")
    try {
        await self.channelWrapper.assertQueue(queue, { durable: true })
        await self.channelWrapper.prefetch(1)
    } catch (error) {
        logger.error(error)
    }
}


/**
 * This produces a message on RMQ, assumes that the connect() method was previously called
 * @param {string} queue name of the queue
 * @param {string} message stringified text to be put on the queue
 * @param {boolean} [persistent="true"] if true the message is stored peristently on the queue
 * @returns {Promise} Resolved when the message was produced on the queue
 * @throws {exception}
 */
Exchange.prototype.produce = async (queue, message, persistent = true) => {
    try {
        await self.channelWrapper.sendToQueue(queue, Buffer.from(message), { persistent })
        return true
    } catch (error) {
        debug("Message was rejected:", error.stack)
        if (self.channelWrapper) {
            self.channelWrapper.close()
        }
        if (self.connection) {
            self.connection.close()
        }
        return false
    }
}

module.exports = {
    Exchange
}
