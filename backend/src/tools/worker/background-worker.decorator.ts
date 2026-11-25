import { DiscoveryService } from '@nestjs/core';

/** Identifies background workers that can drain and restart during a local demo reset. */
export const BackgroundWorker = DiscoveryService.createDecorator<void>();
