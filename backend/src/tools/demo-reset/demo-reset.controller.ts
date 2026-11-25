import { Controller, Delete, HttpCode } from '@nestjs/common';
import { DemoResetService } from './demo-reset.service';

/** Accepts the local demo's request to clear saved progress. */
@Controller('api/dev')
export class DemoResetController {
  constructor(private readonly demo: DemoResetService) {}

  @Delete('progress')
  @HttpCode(204)
  reset() {
    return this.demo.reset();
  }
}
