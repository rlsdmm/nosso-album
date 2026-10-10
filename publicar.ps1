# Pede a senha mostrando asteriscos e roda o publicar.py
$s1 = Read-Host "Senha do album" -AsSecureString
$s2 = Read-Host "Digite de novo pra confirmar" -AsSecureString

$p1 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s1))
$p2 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s2))

if ($p1 -ne $p2) {
    Write-Host ""
    Write-Host "As senhas nao batem. Rode de novo." -ForegroundColor Red
    exit 1
}

$env:ALBUM_SENHA = $p1
try {
    python publicar.py
    $ok = $LASTEXITCODE -eq 0
} finally {
    Remove-Item Env:ALBUM_SENHA -ErrorAction SilentlyContinue
}
if (-not $ok) { exit 1 }

Write-Host ""
$enviar = Read-Host "Enviar pro site agora? (S/n)"
if ($enviar -eq "n") { exit 0 }

git add -A
git commit -q -m "Atualiza memorias"
git push -q
if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Enviado! Em 1 minutinho aparece no site." -ForegroundColor Magenta
}
