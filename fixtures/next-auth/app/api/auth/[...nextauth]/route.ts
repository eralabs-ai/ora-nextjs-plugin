import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';

// The canonical next-auth mount. The provider itself is a stub — no fixture test ever signs in;
// what's under test is the package.json provider detection (next-auth is human sign-in only, so
// the report steers gated surfaces toward the api_key lane) and the default /api/auth/** gating
// floor keeping this route out of the catalog.
const handler = NextAuth({
  secret: 'fixture-only-not-a-secret',
  providers: [
    CredentialsProvider({
      name: 'Demo',
      credentials: { email: { label: 'Email', type: 'email' } },
      authorize: async () => null,
    }),
  ],
});

export { handler as GET, handler as POST };
