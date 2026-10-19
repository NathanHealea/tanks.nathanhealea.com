import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { JoinError } from '../../net/joinErrors';
import { buildJoinUrl, formatCode, normalizeCode } from '../../net/share';
import { joinErrorMessage, spokenCode } from './messages';

/**
 * Online play connects the two browsers directly. Quick matches move behind a relay before public launch
 * (turn-relay); this line changes with it so it never claims protection that does not exist yet.
 */
export const SHARING_NOTICE =
  "Online play connects you straight to the other player, so each of you can see the other's IP address.";

/** A modal card in the campaign's overlay style, holding any number of actions. */
export function Card({ title, children }: { title: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="overlay-card">
        <h1 id={titleId}>{title}</h1>
        {children}
      </div>
    </div>
  );
}

export const SEARCH_FAILED = "Couldn't start the search. Cancel and try again.";

export function OnlineMenu(props: { onQuick(): void; onCreate(): void; onJoin(): void; onBack(): void }) {
  return (
    <Card title="Play online">
      <p className="online-note">{SHARING_NOTICE}</p>
      <div className="button-column">
        <button type="button" className="primary" onClick={props.onQuick} autoFocus>
          Quick match
        </button>
        <button type="button" className="primary" onClick={props.onCreate}>
          Create private match
        </button>
        <button type="button" className="primary" onClick={props.onJoin}>
          Join with code
        </button>
        <button type="button" className="secondary" onClick={props.onBack}>
          Back
        </button>
      </div>
    </Card>
  );
}

export function Unavailable({ reason, onBack }: { reason: 'no-backend' | 'offline'; onBack(): void }) {
  return (
    <Card title="Online play unavailable">
      <p>{reason === 'offline' ? 'Online play needs an internet connection.' : 'Online play is not set up on this site.'}</p>
      <button type="button" className="primary" onClick={onBack} autoFocus>
        Play the campaign
      </button>
    </Card>
  );
}

export function Searching({ failed, onCancel }: { failed: boolean; onCancel(): void }) {
  return (
    <Card title="Looking for an opponent">
      {failed ? (
        <p className="error-text">{SEARCH_FAILED}</p>
      ) : (
        <p>You'll be matched with the next player who searches.</p>
      )}
      <button type="button" className="secondary" onClick={onCancel} autoFocus>
        Cancel
      </button>
    </Card>
  );
}

function shareFailed(err: unknown) {
  // Closing the share sheet rejects with AbortError; that is the player's choice, not a failure.
  if (!(err instanceof DOMException && err.name === 'AbortError')) console.error('Sharing failed', err);
}

function useSecondsLeft(expiresAt: number | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return expiresAt === undefined ? null : Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

export function PrivateWaiting(props: {
  code: string | undefined;
  expiresAt: number | undefined;
  expired: boolean;
  error: string | null;
  onKeep(): void;
  onNewCode(): void;
  onCancel(): void;
  onExpired(): void;
  announce(message: string): void;
}) {
  const { code, expiresAt, expired } = props;
  const secondsLeft = useSecondsLeft(expiresAt);
  const [copied, setCopied] = useState<string | null>(null);
  const link = code ? buildJoinUrl(code, window.location.origin) : '';
  const canShare = typeof navigator.share === 'function';
  const warning = secondsLeft !== null && secondsLeft <= 60 && !expired;

  const { announce, onExpired } = props;
  useEffect(() => {
    if (warning) announce('Your match code expires in one minute.');
  }, [warning, announce]);
  useEffect(() => {
    if (secondsLeft === 0 && !expired) onExpired();
  }, [secondsLeft, expired, onExpired]);
  // Focus starts on the button after the code, so a screen reader user would not otherwise hear it.
  useEffect(() => {
    if (code) announce(`Match code: ${spokenCode(code)}`);
  }, [code, announce]);

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      props.announce(`${what} copied.`);
    } catch (err) {
      console.error('Copying failed', err);
      props.announce(`Couldn't copy the ${what.toLowerCase()}. Select it and copy it yourself.`);
    }
  };

  if (expired) {
    return (
      <Card title="Code expired">
        <p>Nobody joined in time. Make a new code to try again.</p>
        <div className="button-column">
          <button type="button" className="primary" onClick={props.onNewCode} autoFocus>
            Make a new code
          </button>
          <button type="button" className="secondary" onClick={props.onCancel}>
            Back
          </button>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Private match">
      {props.error && <p className="error-text">{props.error}</p>}
      {code ? (
        <>
          <p>Send this code or link to a friend.</p>
          {/* aria-label is not allowed on a paragraph, so the spelled-out code goes in hidden text instead. */}
          <p className="code-display">
            <span className="sr-only">Match code: {spokenCode(code)}</span>
            <span aria-hidden="true">{formatCode(code)}</span>
          </p>
          <p className="link-text">{link}</p>
          {secondsLeft !== null && (
            <p className={warning ? 'warning-text' : undefined}>
              Code expires in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
            </p>
          )}
          <div className="button-column">
            {canShare ? (
              <button type="button" className="primary" onClick={() => navigator.share({ title: 'Tanks', url: link }).catch(shareFailed)} autoFocus>
                Share link
              </button>
            ) : (
              <button type="button" className="primary" onClick={() => copy(link, 'Link')} autoFocus>
                {copied === 'Link' ? 'Link copied' : 'Copy link'}
              </button>
            )}
            <button type="button" className="primary" onClick={() => copy(code, 'Code')}>
              {copied === 'Code' ? 'Code copied' : 'Copy code'}
            </button>
            <button type="button" className={warning ? 'primary' : 'secondary'} onClick={props.onKeep}>
              Keep this code
            </button>
            <button type="button" className="secondary" onClick={props.onNewCode}>
              Make a new code
            </button>
            <button type="button" className="secondary" onClick={props.onCancel}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p>Making a code…</p>
          <button type="button" className="secondary" onClick={props.onCancel} autoFocus>
            Cancel
          </button>
        </>
      )}
    </Card>
  );
}

export function JoinWithCode(props: {
  initialCode: string;
  fromLink: boolean;
  error: JoinError | null;
  busy: boolean;
  onSubmit(code: string): void;
  onBack(): void;
  announce(message: string): void;
}) {
  const [typed, setTyped] = useState(props.initialCode ? formatCode(props.initialCode) : '');
  const inputId = useId();
  const errorId = useId();
  const [formatError, setFormatError] = useState(false);
  const message = formatError ? 'Codes are 6 letters and numbers, like HK7-Q2M.' : props.error ? joinErrorMessage(props.error) : null;

  const input = useRef<HTMLInputElement>(null);
  const { announce } = props;
  // Focus returns to the field so its error description is read with it.
  useEffect(() => {
    if (!message) return;
    announce(message);
    input.current?.focus();
  }, [message, announce]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (props.busy) return;
    const code = normalizeCode(typed);
    setFormatError(!code);
    if (code) props.onSubmit(code);
  };

  return (
    <Card title={props.fromLink && props.initialCode ? `Join ${formatCode(props.initialCode)}?` : 'Join with code'}>
      <form onSubmit={submit}>
        <label htmlFor={inputId}>Match code</label>
        <input
          id={inputId}
          ref={input}
          className="code-input"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          maxLength={7}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? errorId : undefined}
          autoFocus={!props.fromLink}
        />
        {message && (
          <p id={errorId} className="error-text">
            {message}
          </p>
        )}
        <div className="button-column">
          {/* aria-disabled rather than disabled, so focus is not dropped from the button while joining. */}
          <button type="submit" className="primary" aria-disabled={props.busy} autoFocus={props.fromLink}>
            {props.busy ? 'Joining…' : 'Join'}
          </button>
          <button type="button" className="secondary" onClick={props.onBack}>
            Back
          </button>
        </div>
      </form>
    </Card>
  );
}
