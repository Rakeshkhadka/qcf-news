import { timeAgo } from '../lib/api';

type TimeStampProps = {
  /** ISO 8601 timestamp from the API. */
  iso: string;
  className?: string;
  /** Show the absolute date instead of "3 hrs ago". */
  absolute?: boolean;
};

const ABSOLUTE = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
});

/**
 * A published date that both readers and machines can use.
 *
 * "3 hrs ago" is the right thing for a reader scanning a rail and useless to
 * everything else: crawlers, Google News freshness ranking and the `<time>`
 * element itself all need the real instant. Rendering the relative string
 * inside a `<time dateTime>` gives each of them what they need from the same
 * element, and `title` puts the exact date one hover away.
 */
export function TimeStamp({ iso, className, absolute = false }: TimeStampProps) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const exact = ABSOLUTE.format(date);
  return (
    <time className={className} dateTime={date.toISOString()} title={exact}>
      {absolute ? exact : timeAgo(iso)}
    </time>
  );
}
