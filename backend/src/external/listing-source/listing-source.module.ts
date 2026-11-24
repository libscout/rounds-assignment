import { Module } from '@nestjs/common';
import { ListingSourceClient } from './listing-source.client';

/** Provides the listing source client to the polling module. */
@Module({ providers: [ListingSourceClient], exports: [ListingSourceClient] })
export class ListingSourceModule {}
