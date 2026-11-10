# Silence Cutter — panneau Premiere Pro

Petit panneau (extension CEP) pour **Adobe Premiere Pro** qui coupe automatiquement les silences d'une timeline, avec FFmpeg. Projet perso, développé avec l'aide de l'IA, testé sur Windows.

Version actuelle : **v0.2**

Détecte les silences avec FFmpeg, puis soit crée **une nouvelle séquence** sans les blancs, soit pose des **marqueurs** pour t'en montrer l'emplacement. Ta séquence d'origine n'est jamais coupée.

## Installation / mise à jour (Windows)

1. **FFmpeg** (une seule fois) : PowerShell, `winget install Gyan.FFmpeg`.
2. Extrais le zip, double-clique sur **`install.bat`** (il remplace l'ancienne version).
3. **Ferme complètement Premiere**, relance-le.
4. **Fenêtre > Extensions > Silence Cutter**.

## Utilisation

1. Sélectionne **un ou plusieurs clips** dans la timeline (rien de sélectionné = toute la piste V1).
2. Choisis un **preset** (Talking head, Podcast, Agressif) ou règle à la main.
3. **Résultat** : « Nouvelle séquence » ou « Marqueurs seulement (aperçu) ».
4. **1. Analyser** → statistiques, puis **2.** pour appliquer.

Astuce : fais d'abord un passage en « Marqueurs » pour vérifier les coupes, puis relance en « Nouvelle séquence ».

Piste audio : si ton fichier a plusieurs pistes audio (ex. enregistrement OBS), mets le numéro de celle de ta voix (0 = première).

## Limites

- Les appels à l'API de montage de Premiere n'ont été testés que sur une simulation : si une erreur apparaît dans le cadre noir, copie-la.
- Vitesse des clips à 100 % uniquement. Les clips sont mis bout à bout dans l'ordre de la timeline (les trous entre clips disparaissent).
- Pas encore : accélérer les silences, fondus audio automatiques, suppression des « euh », sous-titres, version UXP.

## Déboguer

Premiere lancé, ouvre `http://localhost:8088` dans Chrome pour voir la console du panneau.
