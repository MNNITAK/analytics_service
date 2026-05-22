import amqplib, { Connection, Channel, ConsumeMessage } from 'amqplib';

const EXCHANGE_NAME = 'synapto.topic';
const EXCHANGE_TYPE = 'topic';
const DLX_EXCHANGE = 'synapto.dlx';
const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 5000;

let connection: Connection | null = null;
let channel: Channel | null = null;
let isConnecting = false;

export const connectRabbitMQ = async (): Promise<void> => {
  if (isConnecting) return;
  isConnecting = true;

  const url = process.env.RABBITMQ_URL;
  if (!url) {
    console.warn('[AnalyticsService][RabbitMQ] RABBITMQ_URL not set. Running without message queue.');
    isConnecting = false;
    return;
  }

  let attempts = 0;

  while (attempts < MAX_RETRIES) {
    try {
      connection = await amqplib.connect(url);
      channel = await connection.createChannel();

      await channel.assertExchange(EXCHANGE_NAME, EXCHANGE_TYPE, { durable: true });
      await channel.assertExchange(DLX_EXCHANGE, 'fanout', { durable: true });
      await channel.assertQueue('synapto.dlx.queue', { durable: true });
      await channel.bindQueue('synapto.dlx.queue', DLX_EXCHANGE, '#');

      console.log('[AnalyticsService][RabbitMQ] Connected successfully');

      connection.on('error', (err) => {
        console.error('[AnalyticsService][RabbitMQ] Connection error:', err.message);
        connection = null;
        channel = null;
        isConnecting = false;
        setTimeout(() => connectRabbitMQ(), RETRY_DELAY_MS);
      });

      connection.on('close', () => {
        console.warn('[AnalyticsService][RabbitMQ] Connection closed. Reconnecting...');
        connection = null;
        channel = null;
        isConnecting = false;
        setTimeout(() => connectRabbitMQ(), RETRY_DELAY_MS);
      });

      isConnecting = false;
      return;
    } catch (error) {
      attempts++;
      console.error(
        `[AnalyticsService][RabbitMQ] Attempt ${attempts}/${MAX_RETRIES} failed:`,
        (error as Error).message
      );
      if (attempts < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }

  console.error('[AnalyticsService][RabbitMQ] All connection attempts failed. Running without queue.');
  isConnecting = false;
};

export const consumeEvent = async (
  queueName: string,
  routingKeys: string[],
  handler: (routingKey: string, payload: Record<string, unknown>, msg: ConsumeMessage) => Promise<void>
): Promise<void> => {
  if (!channel) {
    console.warn(`[AnalyticsService][RabbitMQ] Cannot consume from ${queueName}: no channel`);
    return;
  }

  try {
    await channel.assertQueue(queueName, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': DLX_EXCHANGE,
        'x-message-ttl': 86400000,
      },
    });

    for (const key of routingKeys) {
      await channel.bindQueue(queueName, EXCHANGE_NAME, key);
    }

    channel.prefetch(10);

    await channel.consume(queueName, async (msg) => {
      if (!msg) return;

      const routingKey = msg.fields.routingKey;
      let payload: Record<string, unknown> = {};

      try {
        payload = JSON.parse(msg.content.toString());
      } catch {
        console.error(`[AnalyticsService][RabbitMQ] Failed to parse message on ${routingKey}`);
        channel?.nack(msg, false, false);
        return;
      }

      try {
        await handler(routingKey, payload, msg);
        channel?.ack(msg);
      } catch (error) {
        console.error(`[AnalyticsService][RabbitMQ] Handler error for ${routingKey}:`, error);
        const retryCount = (msg.properties.headers?.['x-retry-count'] ?? 0) as number;
        if (retryCount < 3) {
          channel?.nack(msg, false, true);
        } else {
          channel?.nack(msg, false, false);
        }
      }
    });

    console.log(`[AnalyticsService][RabbitMQ] Consuming from: ${queueName}`);
  } catch (error) {
    console.error(`[AnalyticsService][RabbitMQ] Failed to set up consumer for ${queueName}:`, error);
  }
};

export const closeRabbitMQ = async (): Promise<void> => {
  try {
    await channel?.close();
    await connection?.close();
  } catch (error) {
    console.error('[AnalyticsService][RabbitMQ] Error during close:', error);
  }
};
