import Replicate from 'replicate';

/**
 * Пул Replicate API клиентов для параллельной обработки
 * Автоматически распределяет нагрузку между несколькими API ключами
 * 
 * Улучшения стабильности:
 * - Проверка доступности сервиса
 * - Fallback на другой ключ при ошибке
 * - Экспоненциальная задержка между retry
 */

interface ReplicateClient {
  client: Replicate;
  activeRequests: number;
  keyIndex: number;
  maxConcurrent: number;
  lastError?: string;
  lastErrorTime?: number;
  consecutiveErrors: number;
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
      consecutiveErrors: 0,
    }));

    console.log(
      `🔑 Initialized Replicate pool with ${this.clients.length} API key(s) (max ${this.MAX_CONCURRENT_PER_KEY} request per key for stability)`
    );
  }

  /**
   * Проверить доступность сервиса Replicate
   */
  async checkServiceAvailable(): Promise<{ available: boolean; error?: string }> {
    if (this.clients.length === 0) {
      return { available: false, error: 'No clients configured' };
    }

    try {
      const client = this.clients[0].client;
      // Простой тест - получить информацию о модели
      await client.models.get('google', 'gemini-2.5-flash');
      console.log('✅ Replicate service is available');
      return { available: true };
    } catch (e: any) {
      const error = e?.message || String(e);
      console.error('❌ Replicate service check failed:', error);
      return { available: false, error };
    }
  }

  /**
   * Отметить ошибку для клиента
   */
  markClientError(keyIndex: number, error: string) {
    const client = this.clients.find(c => c.keyIndex === keyIndex);
    if (client) {
      client.lastError = error;
      client.lastErrorTime = Date.now();
      client.consecutiveErrors++;
      console.log(`⚠️ API key #${keyIndex} error count: ${client.consecutiveErrors}`);
    }
  }

  /**
   * Сбросить ошибки для клиента после успеха
   */
  markClientSuccess(keyIndex: number) {
    const client = this.clients.find(c => c.keyIndex === keyIndex);
    if (client) {
      client.consecutiveErrors = 0;
      client.lastError = undefined;
    }
  }

  /**
   * Получить клиент, исключая проблемные (с недавними ошибками)
   */
  async getHealthyClient(): Promise<{
    client: Replicate;
    keyIndex: number;
    release: () => void;
  }> {
    const now = Date.now();
    const ERROR_COOLDOWN_MS = 30000; // 30 сек кулдаун после ошибки

    // Сортируем клиенты: меньше ошибок = приоритет
    const sortedClients = [...this.clients].sort((a, b) => {
      // Если у клиента была ошибка недавно, понижаем приоритет
      const aRecentError = a.lastErrorTime && (now - a.lastErrorTime) < ERROR_COOLDOWN_MS;
      const bRecentError = b.lastErrorTime && (now - b.lastErrorTime) < ERROR_COOLDOWN_MS;
      
      if (aRecentError && !bRecentError) return 1;
      if (!aRecentError && bRecentError) return -1;
      
      // Меньше consecutive errors = лучше
      return a.consecutiveErrors - b.consecutiveErrors;
    });

    // Ищем доступный клиент
    for (const client of sortedClients) {
      if (client.activeRequests < client.maxConcurrent) {
        client.activeRequests++;
        console.log(
          `🔑 Using API key #${client.keyIndex} (healthy, errors: ${client.consecutiveErrors}, ${client.activeRequests}/${client.maxConcurrent} active)`
        );
        return {
          client: client.client,
          keyIndex: client.keyIndex,
          release: () => {
            client.activeRequests--;
            console.log(`🔓 Released API key #${client.keyIndex}`);
          },
        };
      }
    }

    // Если все заняты, используем обычный метод с ожиданием
    return this.getLeastLoadedClient();
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
    // Gemini 3 Pro обрабатывает ~2-4 минуты на чанк, увеличиваем timeout
    let attempts = 0;
    const maxAttempts = 300; // 300 * 1000ms = 5 minutes max wait

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

