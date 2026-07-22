import React, { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, Mail, ShieldCheck, Loader2 } from "lucide-react";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { useBranding } from "@/hooks/use-branding";

const friendlyError = (msg: string): string => {
  const lower = msg.toLowerCase();
  if (lower.includes("invalid login") || lower.includes("invalid credentials"))
    return "Incorrect email or password. Please try again.";
  if (lower.includes("invalid api key") || lower.includes("api key"))
    return "Service configuration error. Please contact your administrator.";
  if (lower.includes("not found") || lower.includes("no user") || lower.includes("user not found"))
    return "No account found with that email address.";
  if ((lower.includes("expired") || lower.includes("session")) && !lower.includes("credential") && !lower.includes("token missing") && !lower.includes("no credential"))
    return "Your session has expired. Please sign in again.";
  if (lower.includes("too many") || lower.includes("rate") || lower.includes("throttle"))
    return "Too many attempts. Please wait a moment and try again.";
  if (lower.includes("network") || lower.includes("fetch") || lower.includes("failed to fetch"))
    return "Unable to connect. Please check your internet connection.";
  if (lower.includes("not configured"))
    return "This environment is not yet configured. Please contact your administrator.";
  if (lower.includes("disabled") || lower.includes("blocked") || lower.includes("locked"))
    return "This account has been disabled. Please contact your administrator.";
  if (lower.includes("two-factor") || lower.includes("2fa") || lower.includes("not enabled"))
    return "Two-factor authentication is required but not enabled for this account. Please contact your administrator.";
  if (lower.includes("verification failed") || lower.includes("invalid code") || lower.includes("totp") || lower.includes("invalid totp"))
    return "Invalid verification code. Please check and try again.";
  if (lower.includes("password"))
    return "Incorrect password. Please try again.";
  if (lower.includes("email"))
    return "Please check your email address and try again.";
  if (lower.includes("internal server"))
    return "Something went wrong on our end. Please try again shortly.";
  if (msg) return msg;
  return "Something went wrong. Please try again.";
};

interface LoginPageProps {
  environment?: string;
}

const LoginPage: React.FC<LoginPageProps> = ({ environment = "production" }) => {
  const { login, verify2FA } = useAuth();
  const { logoUrl } = useBranding();
  const [step, setStep] = useState<"credentials" | "2fa">("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [challengeToken, setChallengeToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const isSandbox = environment === "sandbox";

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await login(email, password, environment);
      if (result.requires2FA) {
        setChallengeToken(result.challengeToken || "");
        setStep("2fa");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      setError(friendlyError(msg));
    } finally {
      setLoading(false);
    }
  };

  const handle2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await verify2FA(otpCode, challengeToken);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      const lower = msg.toLowerCase();
      // Upstream invalidates the challenge token after a wrong code, so send
      // the user back to credentials to request a fresh challenge.
      if (lower.includes("expired challenge") || lower.includes("invalid or expired challenge")) {
        setStep("credentials");
        setOtpCode("");
        setChallengeToken("");
        setError("Your verification code expired. Please sign in again to receive a new code.");
      } else if (lower.includes("invalid 2fa") || lower.includes("invalid totp") || lower.includes("invalid code")) {
        setOtpCode("");
        setError("Invalid verification code. Please try again.");
      } else {
        setError(friendlyError(msg));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md animate-fade-in">
        <div className="text-center mb-8">
          {logoUrl ? (
            <img src={logoUrl} alt="Logo" className="h-14 w-auto object-contain mb-4 mx-auto" />
          ) : (
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-primary mb-4">
              <ShieldCheck className="w-7 h-7 text-primary-foreground" />
            </div>
          )}
          <h1 className="text-2xl font-bold font-display text-foreground">Invoice Center</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {isSandbox ? "Sandbox Environment Login" : "Secure access to your invoicing platform"}
          </p>
          {isSandbox && (
            <span className="inline-block mt-2 px-2 py-0.5 rounded bg-accent text-accent-foreground text-xs font-semibold tracking-wide uppercase">
              Sandbox
            </span>
          )}
        </div>

        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          {step === "credentials" ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@company.com"
                    className="pl-10"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    className="pl-10"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Sign In"}
              </Button>
            </form>
          ) : (
            <form onSubmit={handle2FA} className="space-y-5">
              <div className="text-center space-y-1">
                <p className="text-sm font-medium text-foreground">Two-Factor Authentication</p>
                <p className="text-xs text-muted-foreground">Enter the 6-digit code from your authenticator app</p>
              </div>
              <div className="flex justify-center">
                <InputOTP maxLength={6} value={otpCode} onChange={setOtpCode}>
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
              </div>
              {error && <p className="text-sm text-destructive text-center">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading || otpCode.length < 6}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify"}
              </Button>
              <button
                type="button"
                onClick={() => { setStep("credentials"); setOtpCode(""); setError(""); }}
                className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Back to login
              </button>
            </form>
          )}
        </div>

      </div>
    </div>
  );
};

export default LoginPage;
