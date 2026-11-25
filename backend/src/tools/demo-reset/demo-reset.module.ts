import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { DemoMocksClient } from '@src/external/demo-mocks/demo-mocks.client';
import { DemoResetController } from './demo-reset.controller';
import { DemoResetRepository } from './demo-reset.repository';
import { DemoResetService } from './demo-reset.service';

/** Provides the opt-in local reset control for the assessment stack. */
@Module({
  imports: [DiscoveryModule],
  providers: [DemoMocksClient, DemoResetRepository, DemoResetService],
  controllers: [DemoResetController],
})
export class DemoResetModule {}
