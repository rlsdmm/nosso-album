# Nosso álbum 💜

Álbum de fotos em linha do tempo, protegido por senha com criptografia de verdade.
No ar em https://rlsdmm.github.io/nosso-album/

## Como funciona

- `index.html`, `style.css`, `app.js`: o site. Destranca o álbum no navegador com a senha.
- `dados/`: fotos e textos criptografados. Sem a senha, é só um monte de dado embaralhado.
- `privado/`: fotos originais. **Nunca vai pro GitHub** (está no `.gitignore`).

## Editar pelo site

1. Lá embaixo no álbum, toque em **✏️ ativar edição** e siga os passos pra criar a chave do GitHub
   (só precisa fazer uma vez; a chave fica guardada criptografada com a senha do álbum).
2. Depois disso, quem souber a senha vê:
   - **＋** pra criar uma memória nova, com fotos direto do celular;
   - **✏️** em cada memória, pra editar, trocar a capa, tirar fotos ou apagar.
3. Salvou, em uns minutinhos aparece em todos os celulares.

As fotos são reduzidas e perdem os dados escondidos (GPS, modelo do celular) antes de criptografar.

Se a chave do GitHub expirar, o site avisa. É só criar outra e colar em **🔑 trocar chave de edição**.

## Sobre a senha

- Maiúsculas e espaços extras não importam (o corretor do celular não atrapalha).
- Se esquecer a senha, o álbum não abre mais. Guarde ela num lugar seguro.

## Mexer no código pelo PC

O site salva direto no GitHub, então antes de mexer aqui rode `git pull`.

O `publicar.py` / `publicar.ps1` (jeito antigo, pelo `privado/memorias.txt`) foi travado depois que a
edição pelo site foi ativada, porque ele apagaria o que foi editado por lá.
