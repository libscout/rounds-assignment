import type { FailedAttempt } from './api';
import { timestamp } from './consts/date-formats.const';
import { outcomes } from './consts/timeline-labels.const';

/** Lists failed source attempts in their recorded order, including failures before a successful retry. */
export default function FailedAttempts({ attempts }: { attempts: FailedAttempt[] }) {
  if (!attempts.length) {
    return null;
  }
  const label =
    attempts.length === 1 ? '1 failed attempt' : `${attempts.length} failed attempts`;

  return (
    <details className="attempt-history">
      <summary>{label}</summary>
      <ol>
        {attempts.map((attempt, index) => (
          <li key={`${attempt.at}-${index}`}>
            <time dateTime={attempt.at}>{timestamp.format(new Date(attempt.at))}</time>
            {' · '}
            {outcomes[attempt.kind].title}
            {attempt.httpStatus !== undefined && ` (HTTP ${attempt.httpStatus})`}
          </li>
        ))}
      </ol>
    </details>
  );
}
