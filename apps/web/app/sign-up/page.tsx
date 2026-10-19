import { SignUpForm } from './sign-up-form';

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ next?: string; email?: string }> }) {
  const { next, email } = await searchParams;
  return <SignUpForm next={next} email={email} />;
}
