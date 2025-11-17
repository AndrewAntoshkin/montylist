import Replicate from 'replicate';

/**
 * Пул Replicate API клиентов для параллельной обработки
 * Автоматически распределяет нагрузку между несколькими API ключами
 */

interface ReplicateClient {
  client: Replicate;
  activeRequests: number;
  keyIndex: number;
  maxConcurrent: number; // Maximum concurrent requests per key
}

class ReplicatePool {
  private clients: ReplicateClient[] = [];
  private roundRobinIndex = 0;
  private readonly MAX_CONCURRENT_PER_KEY = 1; // Max 1 concurrent request per API key (for stability)

  constructor() {
    this.initializeClients();
  }

  /**
   * Инициализация клиентов из переменных окружения
   * Поддерживаются ключи: REPLICATE_API_TOKEN_1, REPLICATE_API_TOKEN_2, и т.д.
   */
  private initializeClients() {
    const keys: string[] = [];

    // Собираем все ключи из env
    for (let i = 1; i <= 10; i++) {
      const key = process.env[`REPLICATE_API_TOKEN_${i}`];
      if (key) {
        keys.push(key);
      }
    }

    // Фоллбэк на старый формат (один ключ)
    if (keys.length === 0 && process.env.REPLICATE_API_TOKEN) {
      keys.push(process.env.REPLICATE_API_TOKEN);
    }

    if (keys.length === 0) {
      throw new Error('No Replicate API tokens found in environment variables');
    }

    // Создаем клиенты
    this.clients = keys.map((key, index) => ({
      client: new Replicate({ auth: key }),
      activeRequests: 0,
      keyIndex: index + 1,
      maxConcurrent: this.MAX_CONCURRENT_PER_KEY,
    }));

    console.log(
      `🔑 Initialized Replicate pool with ${this.clients.length} API key(s) (max ${this.MAX_CONCURRENT_PER_KEY} request per key for stability)`
    );
  }

  /**
   * Получить клиент с наименьшей нагрузкой (с учетом rate limiting)
   * Если все клиенты заняты, возвращает Promise который ждет освобождения
   */
  async getLeastLoadedClient(): Promise<{
    client: Replicate;
    keyIndex: number;
    release: () => void;
  }> {
    if (this.clients.length === 0) {
      throw new Error('No Replicate clients available');
    }

    // Ждем пока появится доступный клиент
    let attempts = 0;
    const maxAttempts = 60; // 60 * 1000ms = 1 minute max wait

    while (attempts < maxAttempts) {
      // Найти клиент с минимальным количеством активных запросов и не превышающий лимит
      const availableClients = this.clients.filter(
        (c) => c.activeRequests < c.maxConcurrent
      );

      if (availableClients.length > 0) {
        // Нашли доступный клиент
        let leastLoaded = availableClients[0];
        for (const client of availableClients) {
          if (client.activeRequests < leastLoaded.activeRequests) {
            leastLoaded = client;
          }
        }

        // Увеличить счетчик активных запросов
        leastLoaded.activeRequests++;

        console.log(
          `🔑 Using API key #${leastLoaded.keyIndex} (${leastLoaded.activeRequests}/${leastLoaded.maxConcurrent} active)`
        );

        // Вернуть клиент и функцию для освобождения
        return {
          client: leastLoaded.client,
          keyIndex: leastLoaded.keyIndex,
          release: () => {
            leastLoaded.activeRequests--;
            console.log(
              `🔓 Released API key #${leastLoaded.keyIndex} (${leastLoaded.activeRequests}/${leastLoaded.maxConcurrent} active)`
            );
          },
        };
      }

      // Все клиенты заняты, ждем 1 секунду
      console.log(`⏳ All API keys busy, waiting... (attempt ${attempts + 1}/${maxAttempts})`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      attempts++;
    }

    throw new Error('Timeout waiting for available Replicate client (all keys busy)');
  }

  /**
   * Получить клиент по round-robin (последовательно)
   */
  getRoundRobinClient(): { client: Replicate; keyIndex: number; release: () => void } {
    if (this.clients.length === 0) {
      throw new Error('No Replicate clients available');
    }

    const selectedClient = this.clients[this.roundRobinIndex];
    this.roundRobinIndex = (this.roundRobinIndex + 1) % this.clients.length;

    selectedClient.activeRequests++;

    console.log(
      `🔑 Using API key #${selectedClient.keyIndex} (round-robin, ${selectedClient.activeRequests} active)`
    );

    return {
      client: selectedClient.client,
      keyIndex: selectedClient.keyIndex,
      release: () => {
        selectedClient.activeRequests--;
        console.log(
          `🔓 Released API key #${selectedClient.keyIndex} (${selectedClient.activeRequests} active)`
        );
      },
    };
  }

  /**
   * Получить статистику использования пула
   */
  getStats() {
    return {
      totalClients: this.clients.length,
      clientStats: this.clients.map(c => ({
        keyIndex: c.keyIndex,
        activeRequests: c.activeRequests,
      })),
    };
  }
}

// Singleton instance
let poolInstance: ReplicatePool | null = null;

/**
 * Получить экземпляр пула Replicate клиентов
 */
export function getReplicatePool(): ReplicatePool {
  if (!poolInstance) {
    poolInstance = new ReplicatePool();
  }
  return poolInstance;
}

/**
 * Сбросить пул (для тестирования)
 */
export function resetReplicatePool() {
  poolInstance = null;
}

