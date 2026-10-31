# Vidéo de présentation de Ledge — design de réalisation

Date : 11 octobre 2026. Concept retenu lors du brainstorming : **« Où est passé mon agent ? »**, raconté par les mascottes de Ledge. Ce document cadre la réalisation de la vidéo ; il ne constitue pas encore un montage ni une commande de production.

## Intention

Faire comprendre en une minute ce que Ledge change dans une journée où plusieurs agents de code travaillent en parallèle : voir qui travaille, repérer une demande, y répondre depuis le bord de l’écran et retrouver le résultat. La vidéo s’adresse à une personne qui connaît les agents en terminal sans forcément connaître Ledge.

La promesse à laisser en mémoire est : **« Vos agents travaillent. Vous savez quand intervenir. »** La narration part d’une situation concrète, puis montre les gestes réels dans l’interface. Elle évite un inventaire de fonctions.

## Format et direction

- **Durée cible :** 60 secondes, avec une marge de 5 secondes au montage.
- **Master :** 1920 × 1080, 16:9, 30 images/s. Garder les textes essentiels dans une zone recadrable en 1:1 et 9:16 pour de futures versions courtes.
- **Langue :** français, interface française, sous-titres intégrés ou livrés séparément. La compréhension doit rester possible sans son.
- **Image :** capture de l’application, bureau sobre, thème sombre « Signal ». La poignée reste ancrée à gauche ; les mascottes servent de repères, pas de personnages qui remplacent l’interface.
- **Rythme :** début légèrement tendu, puis coupes plus calmes dès que Ledge apparaît. Zooms discrets pour rendre les demandes et les réponses lisibles, sans recréer de faux écrans.
- **Son :** une voix off sobre si elle améliore la lecture ; quelques sons de l’application pour les événements clés ; musique instrumentale très légère et libre d’utilisation, ou silence musical si elle gêne la voix.

## Découpage proposé

Les durées sont des cibles de montage, pas des temporisations imposées à l’application.

| Temps | Image et action | Texte à l’écran / voix off | Idée transmise |
| --- | --- | --- | --- |
| 0–8 s | Bureau avec deux ou trois fenêtres de terminal. Plusieurs agents avancent ; une demande apparaît dans l’une d’elles. | « Plusieurs agents travaillent. Lequel attend votre réponse ? » | Le problème est immédiatement reconnaissable. |
| 8–17 s | Le cadrage s’élargit sur le bord gauche : la mascotte de la session concernée signale l’attente ; la bulle s’ouvre sans prendre le focus. | « Ledge vous le montre, là où vous travaillez. » | La demande arrive sans chasse au bon onglet. |
| 17–30 s | Ouverture de la session. La commande demandée et son dossier sont visibles. Un clic sur « Autoriser » ; l’état repasse au travail après confirmation. | « Voyez la demande. Décidez depuis le bord de l’écran. » | L’action est lisible et reliée à la bonne session. |
| 30–42 s | Ouverture de la liste. On voit les sessions regroupées par projet, avec des états différents et leurs mascottes. | « Et gardez une vue sur tous vos agents. » | Ledge sert aussi de tableau de bord. |
| 42–53 s | Une session termine. Courte notification, puis ouverture de sa réponse mise en forme dans Ledge. | « Quand le travail est fini, le résultat est à portée de main. » | La boucle de travail se termine clairement. |
| 53–60 s | Retour au bureau et à la poignée discrète. Logo/nom Ledge et phrase finale. | « Ledge. Vos agents travaillent. Vous savez quand intervenir. » | Nom et promesse mémorisables. |

## Mise en scène des interactions

La scène suit **une même session principale**, nommée Otto, du signal d’attente au retour au travail. Une deuxième session continue de travailler et une troisième est disponible ou terminée. Ces états donnent du sens aux couleurs et à la liste sans imposer au spectateur de lire plusieurs conversations.

La demande choisie doit être courte et crédible, par exemple une autorisation pour lancer des tests dans un dépôt de démonstration. Montrer clairement le nom de la session, le dossier et le libellé de l’action. Filmer la décision jusqu’au changement d’état confirmé ; ne pas couper au moment du clic comme si le résultat était instantané.

La dernière réponse de l’agent doit être courte et vraie pour la scène : un titre, deux actions effectuées et une vérification. Son contenu à l’écran doit correspondre à ce que l’agent a réellement fait dans le scénario enregistré. Le terminal reste accessible visuellement, mais les détails techniques illisibles n’ont pas à remplir l’image.

## Matériel de tournage et méthode

- Préparer un dépôt et des sessions de démonstration sans données personnelles, clés, chemins privés ni notifications d’autres applications.
- Enregistrer en priorité l’interface Ledge et ses interactions à taille lisible. Utiliser des sessions contrôlées pour déclencher les états au bon moment ; la [visite de l’interface](tour.md) et les [captures existantes](screens/list-dark.png) servent de référence visuelle.
- Les captures du dépôt sont produites par l’application web avec un daemon simulé. Elles aident au storyboard et aux essais de cadrage ; le tournage final doit être revu contre le comportement de la version montrée, particulièrement pour la fenêtre native Windows, la bulle et le changement d’état après décision.
- Capturer chaque action en plans séparés avec quelques secondes de marge avant et après. Ajouter les recadrages, le texte et les sous-titres au montage ; conserver les libellés réels de l’interface.
- Enregistrer les sons de l’application séparément pour régler leur niveau. Éviter qu’une notification sonore suggère un événement différent de celui filmé.

## Texte de voix off, version de travail

> Plusieurs agents travaillent dans vos terminaux. Mais quand l’un d’eux a besoin de vous, où regarder ?
>
> Ledge suit vos sessions au bord de l’écran. Une demande arrive : voyez laquelle, lisez-la et répondez sans chercher le bon onglet.
>
> Retrouvez tous vos agents par projet. Et quand l’un termine, ouvrez son résultat directement dans Ledge.
>
> Ledge. Vos agents travaillent. Vous savez quand intervenir.

La voix off ne doit pas redire mot pour mot tout ce qui est écrit à l’écran. Si le rythme des captures rend le texte trop dense, privilégier les phrases du début et de la fin ; les actions centrales se comprennent aussi par les sous-titres et l’interface.

## Livrables et validation

1. **Animatique** : assemblage des captures provisoires et des textes avec le bon timing, sans finition sonore.
2. **Montage principal** : version française 16:9 avec son, sous-titres et écran final.
3. **Exports utiles** : fichier master, version sous-titrée, version sans sous-titres incrustés et image de couverture issue d’une vraie capture. Les déclinaisons verticales viennent après validation du master.

La vidéo est prête lorsque, après un seul visionnage sans son, une personne peut dire **ce que surveille Ledge, comment elle répond à une demande et où elle retrouve le résultat**. Revoir chaque affirmation et chaque écran contre la version de l’application filmée. Les transitions ne doivent pas masquer une étape nécessaire ni faire passer une simulation pour une capacité différente du produit.
