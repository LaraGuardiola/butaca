# Butaca 🍿

Tu Netflix casero: servidor en Bun + app nativa para Samsung Tizen (QN90B, Tizen 6.5).

```
server/   Bun + bun:sqlite + ffmpeg. Escanea, indexa, sirve vídeo con Range y subtítulos WebVTT.
tv/       SolidJS → .wgt para Tizen. Reproduce con AVPlay (decodificación por hardware).
scripts/  tv-deploy.sh: compila, firma, instala y abre la app en la tele.
```

## Uso

```sh
cp butaca.config.example.json butaca.config.json   # carpetas de la biblioteca
bun run server                                      # http://<ip-del-pc>:8420 (vista previa en el navegador)
bun run deploy:tv                                   # instala en la tele (TV_IP=192.168.1.33 por defecto)
```

Para portadas, logos y sinopsis en español añade `"tmdbToken"` (token de lectura de themoviedb.org)
a `butaca.config.json` o exporta `TMDB_TOKEN`. Sin él se usan fotogramas de los propios vídeos.

## Mando

| Tecla | Navegación | Reproductor |
|---|---|---|
| Flechas | Moverse | ◀ ▶ avanzar/retroceder (acelera si mantienes) · ▲ audio y subtítulos |
| OK | Abrir | Pausa / siguiente episodio cuando aparece la tarjeta |
| Atrás | Volver / salir | Salir guardando el progreso |
