import { useAccount } from "../../../src/lib/account";
import { Button } from "../ui/Button";
import logo from "../../../assets/brand/polarity-colored.svg";

/**
 * The way in, until the redesign's sign-in, onboarding and profile screens are built: go in without an account, or
 * pick a profile when signed in.
 */
export function Welcome() {
  const { status, profiles, continueAsGuest, chooseProfile } = useAccount();
  return (
    <div className="welcome page-enter">
      <img src={logo} alt="Polarity" className="welcome-logo" draggable={false} />
      {status === "profiles" ? (
        <>
          <h1 className="t-page">Who's watching</h1>
          <ul className="welcome-profiles">
            {profiles.map((p) => (
              <li key={p.id}>
                <Button kind="secondary" size="large" onClick={() => void chooseProfile(p)}>
                  {p.name}
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p className="muted welcome-note">
            Signing in isn't built in the redesign yet. Use the current app to sign in, or look around without an
            account.
          </p>
          <Button kind="primary" size="large" onClick={continueAsGuest}>
            Continue without an account
          </Button>
        </>
      )}
    </div>
  );
}
