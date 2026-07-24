# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.4.x   | Yes |
| 0.3.x   | Yes (security fixes only) |
| < 0.3.0 | No |

## Reporting a Vulnerability

If you discover a security vulnerability in Flow Architect, please report it responsibly:

1. **Do not open a public GitHub issue** for security vulnerabilities.
2. Use [GitHub Security Advisories](https://github.com/ifoohoo/flow-architect/security/advisories/new) to report the vulnerability privately.
3. Include a description of the vulnerability, steps to reproduce, and the potential impact.

You can expect an initial response within 72 hours. We will work with you to understand and address the issue before any public disclosure.

## Disclosure Policy

- We request that reporters do not publicly disclose vulnerability details until a fix has been released.
- Once a fix is available, we will publish a security advisory and credit the reporter (unless anonymity is requested).
- Critical vulnerabilities affecting the offline meeting package CSP sandbox or the schema validation gate will be prioritized.

## Security Considerations

- **Meeting package CSP:** The offline HTML meeting package uses a strict Content Security Policy (`default-src 'none'`; no `unsafe-eval` or network access). Any change that relaxes this policy requires explicit security review.
- **Schema validation:** Export operations are gated by JSON Schema validation. Bypassing or weakening this gate could allow invalid data to propagate.
- **Offline isolation:** The meeting package is designed to work fully offline with no network requests. Any change that introduces network dependencies must be reviewed for privacy implications.
