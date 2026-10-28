import { SignInForm } from './sign-in-form';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; email?: string; twofactor?: string }>;
}) {
  const { error, next, email, twofactor } = await searchParams;
  return <SignInForm initialError={error} next={next} email={email} twoFactor={twofactor} />;
}
