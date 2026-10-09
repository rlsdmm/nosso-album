# Nosso álbum 💜

Álbum de fotos em linha do tempo, protegido por senha com criptografia de verdade.

## Como funciona

- `privado/`: fotos originais e o `memorias.txt`. **Nunca vai pro GitHub** (está no `.gitignore`).
- `dados/`: versão criptografada, gerada pelo `publicar.py`. É o que vai pro GitHub.
  Sem a senha, isso é só um monte de dado embaralhado.
- `index.html`, `style.css`, `app.js`: o site. Destrancam o álbum no navegador com a senha.

## Adicionar memórias

1. Coloque as fotos em `privado/fotos/` (uma pasta por encontro também funciona).
2. Escreva a memória em `privado/memorias.txt`:

   ```
   ## 26/09/2026 | especial | O pedido
   fotos: pedido.jpg, praia/
   lugar: Em casa
   Você disse sim!!
   ```

   Tipos: `encontro`, `comidinha`, `passeio`, `momento`, `especial`.
3. Gere o álbum (ele pede a senha):

   ```
   python publicar.py
   ```

4. Publique:

   ```
   git add -A
   git commit -m "novas memórias"
   git push
   ```

## Sobre a senha

- Maiúsculas e espaços extras não importam (o corretor do celular não atrapalha).
- Se esquecer a senha, o site não abre mais, mas as originais continuam em `privado/`:
  é só rodar `publicar.py` de novo com uma senha nova.
- As fotos são reduzidas e perdem os dados escondidos (GPS, modelo do celular) antes de criptografar.
- **Backup:** as originais só existem no PC. De vez em quando, copie `privado/` pra outro lugar.
