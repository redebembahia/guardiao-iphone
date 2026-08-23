# Guardião iPhone

Aplicativo da web instalável (PWA), adaptado para o iPhone 14 Pro Max. Funciona sem cadastro, publicidade, telemetria ou servidor que receba os dados do diagnóstico.

## Funções

- diagnóstico guiado de armazenamento, bateria, temperatura e desempenho;
- pontuação transparente baseada somente nas informações fornecidas pelo proprietário;
- recomendações priorizadas sem exclusão automática;
- histórico local das últimas 30 análises;
- relatório compartilhável pela folha nativa do iOS;
- análise opcional do tamanho agregado de arquivos escolhidos pelo usuário;
- funcionamento offline após o primeiro acesso;
- interface ajustada às áreas seguras e à Dynamic Island.

## Limites do iOS

O Safari não permite que uma PWA leia o armazenamento geral, a lista de aplicativos, a RAM, a temperatura interna ou a capacidade máxima da bateria. Esses valores são informados pelo proprietário a partir das telas oficiais de Ajustes. O Guardião não possui botões para apagar arquivos, limpar cache ou alterar configurações sozinho.

## Instalação no iPhone

1. Abra o endereço HTTPS no Safari.
2. Toque em **Compartilhar**.
3. Escolha **Adicionar à Tela de Início**.
4. Mantenha **Abrir como App** ativado.
5. Toque em **Adicionar**.

## Publicação gratuita no GitHub Pages

1. Crie um repositório público e envie todos os arquivos desta pasta, incluindo `.github`.
2. Abra **Settings › Pages** no repositório.
3. Em **Build and deployment › Source**, escolha **GitHub Actions**.
4. Abra **Actions** e aguarde o fluxo **Publicar Guardião iPhone** terminar.
5. Use o endereço HTTPS exibido no fluxo para instalar pelo Safari.

O código público contém apenas a interface e as regras do aplicativo. O histórico e os dados preenchidos continuam no navegador do iPhone.

## Desenvolvimento local

Sirva esta pasta por HTTPS ou por um servidor local. Service Workers não funcionam ao abrir `index.html` diretamente como arquivo.
