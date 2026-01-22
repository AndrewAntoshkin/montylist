/**
 * Health Check Endpoint
 * 
 * Проверяет доступность всех внешних зависимостей:
 * - Supabase (database + storage)
 * - FAL.ai
 * - Replicate
 * - Circuit Breakers status
 * 
 * GET /api/health
 * 
 * Response:
 * - 200: All systems operational
 * - 503: One or more systems unavailable
 */

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAllCircuitStats } from '@/lib/circuit-breaker';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface HealthCheck {
  status: 'ok' | 'error' | 'degraded';
  latency?: number;
  error?: string;
}

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  checks: {
    supabase: HealthCheck;
    supabaseStorage: HealthCheck;
    fal: HealthCheck;
    replicate: HealthCheck;
    memory: HealthCheck;
  };
  circuitBreakers: Array<{
    name: string;
    state: string;
    failures: number;
    totalRequests: number;
  }>;
}

/**
 * Проверка подключения к Supabase Database
 */
async function checkSupabase(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const supabase = createServiceRoleClient();
    const { error } = await supabase
      .from('videos')
      .select('id')
      .limit(1);
    
    if (error) {
      return { status: 'error', error: error.message, latency: Date.now() - start };
    }
    return { status: 'ok', latency: Date.now() - start };
  } catch (e: any) {
    return { status: 'error', error: e.message, latency: Date.now() - start };
  }
}

/**
 * Проверка Supabase Storage
 */
async function checkSupabaseStorage(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase.storage
      .from('videos')
      .list('', { limit: 1 });
    
    if (error) {
      return { status: 'error', error: error.message, latency: Date.now() - start };
    }
    return { status: 'ok', latency: Date.now() - start };
  } catch (e: any) {
    return { status: 'error', error: e.message, latency: Date.now() - start };
  }
}

/**
 * Проверка FAL.ai (быстрый ping)
 */
async function checkFal(): Promise<HealthCheck> {
  const start = Date.now();
  
  if (!process.env.FAL_API_KEY) {
    return { status: 'degraded', error: 'FAL_API_KEY not configured', latency: 0 };
  }
  
  try {
    const { fal } = await import('@fal-ai/client');
    fal.config({ credentials: process.env.FAL_API_KEY });
    
    // Simple ping - just check if API responds
    const result = await fal.subscribe('fal-ai/any-llm', {
      input: {
        model: 'google/gemini-flash-1.5',
        prompt: 'Say OK'
      },
      logs: false,
    });
    
    const output = (result.data as any)?.output;
    if (output) {
      return { status: 'ok', latency: Date.now() - start };
    }
    return { status: 'degraded', error: 'Empty response', latency: Date.now() - start };
  } catch (e: any) {
    return { status: 'error', error: e.message?.slice(0, 100), latency: Date.now() - start };
  }
}

/**
 * Проверка Replicate
 */
async function checkReplicate(): Promise<HealthCheck> {
  const start = Date.now();
  
  // Check for any Replicate token (numbered or not)
  const token = process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_TOKEN_1;
  
  if (!token) {
    return { status: 'degraded', error: 'REPLICATE_API_TOKEN not configured', latency: 0 };
  }
  
  try {
    const Replicate = (await import('replicate')).default;
    const replicate = new Replicate({ auth: token });
    
    // Just check if we can get model info (fast operation)
    await replicate.models.get('google', 'gemini-2.5-flash');
    
    return { status: 'ok', latency: Date.now() - start };
  } catch (e: any) {
    return { status: 'error', error: e.message?.slice(0, 100), latency: Date.now() - start };
  }
}

/**
 * Проверка памяти
 */
function checkMemory(): HealthCheck {
  const used = process.memoryUsage();
  const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(used.heapTotal / 1024 / 1024);
  const usagePercent = (used.heapUsed / used.heapTotal) * 100;
  
  if (usagePercent > 90) {
    return { 
      status: 'error', 
      error: `High memory usage: ${heapUsedMB}MB / ${heapTotalMB}MB (${usagePercent.toFixed(1)}%)` 
    };
  }
  if (usagePercent > 75) {
    return { 
      status: 'degraded', 
      error: `Elevated memory usage: ${heapUsedMB}MB / ${heapTotalMB}MB (${usagePercent.toFixed(1)}%)` 
    };
  }
  return { status: 'ok' };
}

/**
 * GET /api/health
 */
export async function GET(): Promise<NextResponse<HealthResponse>> {
  const startTime = Date.now();
  
  // Run all checks in parallel
  const [supabase, supabaseStorage, fal, replicate] = await Promise.all([
    checkSupabase(),
    checkSupabaseStorage(),
    checkFal(),
    checkReplicate(),
  ]);
  
  const memory = checkMemory();
  
  // Get circuit breaker stats
  const circuitStats = getAllCircuitStats().map(stat => ({
    name: stat.name,
    state: stat.state,
    failures: stat.failures,
    totalRequests: stat.totalRequests,
  }));
  
  // Determine overall status
  const checks = { supabase, supabaseStorage, fal, replicate, memory };
  const statuses = Object.values(checks).map(c => c.status);
  
  let overallStatus: 'healthy' | 'degraded' | 'unhealthy';
  
  // Supabase is critical
  if (supabase.status === 'error' || supabaseStorage.status === 'error') {
    overallStatus = 'unhealthy';
  } 
  // All other errors are degraded (we have fallbacks)
  else if (statuses.includes('error')) {
    overallStatus = 'degraded';
  }
  else if (statuses.includes('degraded')) {
    overallStatus = 'degraded';
  }
  else {
    overallStatus = 'healthy';
  }
  
  // Check if any circuit breaker is open
  const openCircuits = circuitStats.filter(c => c.state === 'OPEN');
  if (openCircuits.length > 0 && overallStatus === 'healthy') {
    overallStatus = 'degraded';
  }
  
  const response: HealthResponse = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    version: 'v5-beta',
    checks,
    circuitBreakers: circuitStats,
  };
  
  const httpStatus = overallStatus === 'unhealthy' ? 503 : 200;
  
  console.log(`🏥 Health check: ${overallStatus} (${Date.now() - startTime}ms)`);
  
  return NextResponse.json(response, { status: httpStatus });
}
