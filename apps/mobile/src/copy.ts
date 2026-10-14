/** Every French string of the phone app lives here (decision D13). */
export const copy = {
  appName: 'Ledge',
  shellTitle: 'Ledge sur le téléphone',
  shellSubtitle: 'Connexion au PC en cours de mise en place.',
  pairing: {
    stepOf: (n: number) => `Connexion · ${n} / 4`,
    back: 'Étape précédente',
    steps: [
      { title: 'Votre PC, à portée de main', subtitle: 'Connectez le téléphone au réseau privé de votre PC pour retrouver vos agents.', button: 'Tailscale est connecté' },
      { title: 'Installer Ledge', subtitle: 'Le QR code du PC ouvre l’adresse privée de votre application.', button: 'Ledge est installé' },
      { title: 'Appairer ce téléphone', subtitle: 'Saisissez le code affiché dans Ledge sur votre PC.', button: 'Appairer mon téléphone' },
      { title: 'Vous êtes connecté', subtitle: 'Ce téléphone est appairé à votre PC.', button: 'Continuer' }
    ],
    checklist: [
      { title: 'Connecter Tailscale', hint: 'Sur le PC et le téléphone, utilisez le même réseau privé.' },
      { title: 'Ouvrir le QR code du PC', hint: 'Dans Ledge : Réglages → Mobile. Scannez avec l’appareil photo du téléphone.' },
      { title: 'Installer et appairer Ledge', hint: 'Gardez le PC à proximité pour cette première connexion.' }
    ],
    install: { title: 'Dans Safari sur votre téléphone', body: 'Ouvrez le menu de partage, puis « Sur l’écran d’accueil ». Ouvrez ensuite Ledge depuis sa nouvelle icône.', note: 'Le code d’appairage se saisit dans l’application installée. Les notifications seront proposées ensuite.' },
    codeLabel: 'Code à six chiffres',
    codeHint: 'Code valable 2 minutes.',
    pending: 'Vérification…',
    privacy: { title: 'Réseau privé', body: 'Vous pourrez retirer l’accès de ce téléphone depuis Réglages → Mobile sur le PC.' },
    done: { title: 'Accès confirmé', body: 'Vos demandes et conversations sont disponibles tant que le PC et Tailscale sont connectés.' },
    errors: {
      invalid_code: 'Code non reconnu. Vérifiez le code affiché sur le PC.',
      expired: 'Ce code a expiré. Demandez-en un nouveau sur le PC.',
      locked: "Trop d'essais. Demandez un nouveau code sur le PC.",
      webauthn_failed: "La vérification de l'appareil n'a pas abouti. Réessayez.",
      not_configured: 'Ouvrez Réglages › Mobile sur le PC pour obtenir un code.',
      no_window: 'Ouvrez Réglages › Mobile sur le PC pour obtenir un code.',
      network: 'PC injoignable. Vérifiez Tailscale.'
    }
  }
} as const;
