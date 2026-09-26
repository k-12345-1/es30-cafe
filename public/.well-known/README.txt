Apple Pay domain verification.

Stripe gives you a file called

  apple-developer-merchantid-domain-association

when you add this site under Settings > Payment method domains. Drop it in
this folder, with no extension, and it will be served at

  /.well-known/apple-developer-merchantid-domain-association

which is where Apple looks for it. Nothing else belongs here.
