/**
 * Test AI Services Endpoint
 * 
 * Проверяет доступность Replicate (Gemini) и FAL.ai
 * GET /api/test-ai-services
 */

import { NextResponse } from 'next/server';
import Replicate from 'replicate';
import { fal } from '@fal-ai/client';
import { getAllCircuitStats, resetAllCircuits } from '@/lib/circuit-breaker';

export const dynamic = 'force-dynamic';

interface ServiceStatus {
  name: string;
  available: boolean;
  responseTime?: number;
  error?: string;
  circuitState?: string;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const reset = url.searchParams.get('reset') === 'true';
  
  // Reset circuits if requested
  if (reset) {
    resetAllCircuits();
    console.log('🔄 All circuit breakers reset');
  }
  
  const results: ServiceStatus[] = [];
  const circuitStats = getAllCircuitStats();
  
  // Test Replicate (Gemini)
  const replicateStatus = await testReplicate();
  replicateStatus.circuitState = circuitStats.find(s => s.name === 'gemini-replicate')?.state;
  results.push(replicateStatus);
  
  // Test FAL.ai
  const falStatus = await testFal();
  falStatus.circuitState = circuitStats.find(s => s.name === 'fal-ai')?.state;
  results.push(falStatus);
  
  // Summary
  const allHealthy = results.every(r => r.available);
  
  return NextResponse.json({
    healthy: allHealthy,
    timestamp: new Date().toISOString(),
    services: results,
    circuits: circuitStats,
    recommendation: allHealthy 
      ? '✅ All services available'
      : `⚠️ Issues detected: ${results.filter(r => !r.available).map(r => r.name).join(', ')}`
  });
}

async function testReplicate(): Promise<ServiceStatus> {
  const start = Date.now();
  
  try {
    const apiToken = process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_TOKEN_1;
    if (!apiToken) {
      return {
        name: 'Replicate (Gemini)',
        available: false,
        error: 'REPLICATE_API_TOKEN not configured'
      };
    }
    
    const replicate = new Replicate({ auth: apiToken });
    
    // Simple text test (no video)
    const output = await Promise.race([
      replicate.run('google/gemini-2.5-flash', {
        input: { prompt: 'Say OK in one word' }
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout after 30s')), 30000)
      )
    ]);
    
    const responseTime = Date.now() - start;
    
    if (output) {
      return {
        name: 'Replicate (Gemini)',
        available: true,
        responseTime
      };
    }
    
    return {
      name: 'Replicate (Gemini)',
      available: false,
      responseTime,
      error: 'Empty response'
    };
    
  } catch (error: any) {
    return {
      name: 'Replicate (Gemini)',
      available: false,
      responseTime: Date.now() - start,
      error: error.message || 'Unknown error'
    };
  }
}

async function testFal(): Promise<ServiceStatus> {
  const start = Date.now();
  
  try {
    const falKey = process.env.FAL_API_KEY;
    if (!falKey) {
      return {
        name: 'FAL.ai',
        available: false,
        error: 'FAL_API_KEY not configured'
      };
    }
    
    fal.config({ credentials: falKey });
    
    // Simple text test using any-llm
    const result = await Promise.race([
      fal.subscribe('fal-ai/any-llm', {
        input: {
          model: 'google/gemini-flash-1.5',
          prompt: 'Say OK in one word'
        }
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout after 30s')), 30000)
      )
    ]) as any;
    
    const responseTime = Date.now() - start;
    
    if (result?.data?.output) {
      return {
        name: 'FAL.ai',
        available: true,
        responseTime
      };
    }
    
    return {
      name: 'FAL.ai',
      available: false,
      responseTime,
      error: 'Empty response'
    };
    
  } catch (error: any) {
    return {
      name: 'FAL.ai',
      available: false,
      responseTime: Date.now() - start,
      error: error.message || 'Unknown error'
    };
  }
}

// POST to reset circuits
export async function POST() {
  resetAllCircuits();
  
  return NextResponse.json({
    message: 'All circuit breakers reset',
    circuits: getAllCircuitStats()
  });
}
