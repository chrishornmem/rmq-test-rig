const logger = require('debug-level')('rmq-test-rig')
const amqp = require('amqp-connection-manager')
const EventEmitter = require('events')
const { uuid } = require('uuidv4')
const REPLY_QUEUE = 'amq.rabbitmq.reply-to'

let connection;

const connect = async (host) => {
    if (!host) throw new Error("Missing host param")
    connection = amqp.connect([host], { json: true })
    connection.on('connect', async function () {
        logger.info('Connected!')
        return Promise.resolve()
    })
    connection.on('disconnect', function (params) {
        logger.info('Disconnected.')
        return Promise.reject("Disconnected")
    })
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
            channel.consume(
                q.queue,
                msg => {
                    logger.info("got message:")
                    logger.info(JSON.parse(msg.content.toString('utf8')))
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

Exchange.prototype.initializeExchange = async function (rpc = false) {
    let self = this;
    try {
        if (rpc) {
            self.exchangeChannel = await connection.createChannel({
                json: true,
                setup: channel => {
                    channel.assertExchange(self.name, self.type)
                    self.exchangeChannel.context.responseEmitter = new EventEmitter()
                    self.exchangeChannel.context.responseEmitter.setMaxListeners(0)
                    channel.consume(
                        REPLY_QUEUE,
                        msg => {
                            self.exchangeChannel.context.responseEmitter.emit(
                                msg.properties.correlationId,
                                JSON.parse(msg.content.toString('utf8'))
                            )
                        },
                        { noAck: true }
                    )
                }
            })
        } else {
            self.exchangeChannel = await connection.createChannel({
                json: true,
                setup: function (channel) {
                    // `channel` here is a regular amqplib `ConfirmChannel`.
                    // Note that `this` here is the channelWrapper instance.
                    return channel.assertExchange(self.name, self.type, self.options)
                }
            });
        }
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

// Exchange.prototype.sendRPCMessage = function (message) {
//     logger.info("/sendRPCMessage")
//     logger.info(message)
//     let self = this

//     return new Promise((resolve, reject) => {
//         const correlationId = uuid()
//         let timer

//         self.directChannel.context.responseEmitter.once(correlationId, (response) => {
//             clearTimeout(timer)
//             resolve(response)
//         })

//         timer = setTimeout(() => {
//             logger.error("/sendRPCMessage - response not received within 10s")
//             reject("Message not received within required time")
//         }, 10000)

//         self.directChannel.sendToQueue('rpc_queue', message, {
//             correlationId,
//             replyTo: REPLY_QUEUE,
//             contentType: 'application/json'
//         })
//     })
// }

Exchange.prototype.sendRPCMessage = async function (message) {

    let self = this;
    const id = uuid();
    const q = self.directChannel.context.q;

    self.directChannel.sendToQueue('rpc_queue', new Buffer(message.toString()),
    { correlationId: id, replyTo: q.queue })
    .then((message) => {
      console.log('Message sent');
      console.log(message)
    }).catch((err) => {
      console.log('Message was rejected:', err.stack);
    //   self.directChannel.close();
    //   connection.close();
        throw err
    });
    return true
}


module.exports = {
    Exchange,
    connect
}
