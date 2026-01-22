/**
 * Circuit Breaker Pattern Implementation
 * 
 * Предотвращает каскадные сбои при падении внешних API.
 * При достижении порога ошибок — временно отключает запросы к API.
 * 
 * Состояния:
 * - CLOSED: Нормальная работа, запросы проходят
 * - OPEN: API недоступен, запросы блокируются
 * - HALF_OPEN: Тестовый режим после cooldown
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Количество ошибок для срабатывания (default: 3) */
  threshold: number;
  /** Время cooldown в ms (default: 60000) */
  cooldown: number;
  /** Timeout для half-open теста в ms (default: 10000) */
  halfOpenTimeout?: number;
}

export interface CircuitBreakerStats {
  name: string;
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure: Date | null;
  lastSuccess: Date | null;
  totalRequests: number;
  totalFailures: number;
}

const DEFAULT_OPTIONS: CircuitBreakerOptions = {
  threshold: 3,
  cooldown: 60000,
  halfOpenTimeout: 10000,
};

/**
 * Circuit Breaker для защиты от каскадных сбоев внешних API
 */
export class CircuitBreaker {
  private name: string;
  private options: Required<CircuitBreakerOptions>;
  private state: CircuitState = 'CLOSED';
  private failures: number = 0;
  private successes: number = 0;
  private lastFailureTime: number = 0;
  private lastSuccessTime: number = 0;
  private totalRequests: number = 0;
  private totalFailures: number = 0;

  constructor(name: string, options: Partial<CircuitBreakerOptions> = {}) {
    this.name = name;
    this.options = { ...DEFAULT_OPTIONS, ...options } as Required<CircuitBreakerOptions>;
  }

  /**
   * Проверить, открыт ли circuit (API недоступен)
   */
  isOpen(): boolean {
    if (this.state === 'CLOSED') {
      return false;
    }

    if (this.state === 'OPEN') {
      // Проверяем, прошёл ли cooldown
      const now = Date.now();
      if (now - this.lastFailureTime >= this.options.cooldown) {
        // Переходим в HALF_OPEN для тестового запроса
        this.state = 'HALF_OPEN';
        console.log(`🔄 [CircuitBreaker:${this.name}] OPEN → HALF_OPEN (cooldown expired)`);
        return false;
      }
      return true;
    }

    // HALF_OPEN - пропускаем один запрос для теста
    return false;
  }

  /**
   * Записать успешный запрос
   */
  recordSuccess(): void {
    this.successes++;
    this.totalRequests++;
    this.lastSuccessTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      // Тестовый запрос успешен — закрываем circuit
      this.state = 'CLOSED';
      this.failures = 0;
      console.log(`✅ [CircuitBreaker:${this.name}] HALF_OPEN → CLOSED (test request succeeded)`);
    } else if (this.state === 'CLOSED') {
      // Сбрасываем счётчик ошибок при успехе
      this.failures = 0;
    }
  }

  /**
   * Записать неудачный запрос
   */
  recordFailure(error?: string): void {
    this.failures++;
    this.totalFailures++;
    this.totalRequests++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      // Тестовый запрос неудачен — снова открываем circuit
      this.state = 'OPEN';
      console.log(`❌ [CircuitBreaker:${this.name}] HALF_OPEN → OPEN (test request failed: ${error || 'unknown'})`);
    } else if (this.state === 'CLOSED' && this.failures >= this.options.threshold) {
      // Достигли порога ошибок — открываем circuit
      this.state = 'OPEN';
      console.log(`🚨 [CircuitBreaker:${this.name}] CLOSED → OPEN (${this.failures} consecutive failures)`);
      console.log(`   Cooldown: ${this.options.cooldown / 1000}s, Error: ${error || 'unknown'}`);
    }
  }

  /**
   * Выполнить функцию с защитой circuit breaker
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.isOpen()) {
      const remainingCooldown = Math.max(0, this.options.cooldown - (Date.now() - this.lastFailureTime));
      throw new CircuitOpenError(
        this.name,
        `Circuit is OPEN. Retry in ${Math.round(remainingCooldown / 1000)}s`
      );
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.recordFailure(errorMsg);
      throw error;
    }
  }

  /**
   * Получить текущее состояние
   */
  getState(): CircuitState {
    // Обновляем состояние если нужно
    this.isOpen();
    return this.state;
  }

  /**
   * Получить статистику
   */
  getStats(): CircuitBreakerStats {
    return {
      name: this.name,
      state: this.getState(),
      failures: this.failures,
      successes: this.successes,
      lastFailure: this.lastFailureTime ? new Date(this.lastFailureTime) : null,
      lastSuccess: this.lastSuccessTime ? new Date(this.lastSuccessTime) : null,
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures,
    };
  }

  /**
   * Принудительно сбросить circuit
   */
  reset(): void {
    this.state = 'CLOSED';
    this.failures = 0;
    console.log(`🔄 [CircuitBreaker:${this.name}] Manually reset to CLOSED`);
  }
}

/**
 * Ошибка когда circuit открыт
 */
export class CircuitOpenError extends Error {
  constructor(
    public readonly circuitName: string,
    message: string
  ) {
    super(message);
    this.name = 'CircuitOpenError';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SINGLETON INSTANCES для внешних API
// ═══════════════════════════════════════════════════════════════════════════

/** Circuit Breaker для Gemini на Replicate */
export const geminiCircuitBreaker = new CircuitBreaker('gemini-replicate', {
  threshold: 3,
  cooldown: 60000, // 1 минута
});

/** Circuit Breaker для FAL.ai */
export const falCircuitBreaker = new CircuitBreaker('fal-ai', {
  threshold: 3,
  cooldown: 60000, // 1 минута
});

/** Circuit Breaker для AssemblyAI */
export const assemblyAICircuitBreaker = new CircuitBreaker('assemblyai', {
  threshold: 2,
  cooldown: 120000, // 2 минуты (AssemblyAI более критичен)
});

/**
 * Получить статистику всех circuit breakers
 */
export function getAllCircuitStats(): CircuitBreakerStats[] {
  return [
    geminiCircuitBreaker.getStats(),
    falCircuitBreaker.getStats(),
    assemblyAICircuitBreaker.getStats(),
  ];
}

/**
 * Сбросить все circuit breakers
 */
export function resetAllCircuits(): void {
  geminiCircuitBreaker.reset();
  falCircuitBreaker.reset();
  assemblyAICircuitBreaker.reset();
}
