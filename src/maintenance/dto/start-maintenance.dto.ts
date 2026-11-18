import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** The longest notice maintenance can be given: a day. */
export const MAX_NOTICE_MINUTES = 24 * 60;

export class StartMaintenanceDto {
  /** Minutes from now until it's set to begin - 0, or left out, for now. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_NOTICE_MINUTES)
  minutes?: number;
}
