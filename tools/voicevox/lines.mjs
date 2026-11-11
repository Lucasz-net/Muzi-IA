/**
 * Frases de Mizu en japonés (voz: VOICEVOX 四国めたん "あまあま", speaker 0) con su traducción al español.
 * Fuente de verdad: `generate.mjs` genera de aquí los audios (assets/voice/ja/) y el manifiesto (src/voice/ja/lines.json).
 * Para añadir o cambiar una frase: editar aquí, abrir el motor de VOICEVOX y ejecutar `node tools/voicevox/generate.mjs`.
 * Cada categoría es una lista de [japonés, español]; el id de cada audio es `categoría_NN`.
 *
 * Voz: VOICEVOX:四国めたん
 */
export const LINES = {
  // Al arrancar la app
  startup: [
    ["おはよう！ 今日もよろしくね。", "¡Buenos días! Hoy también cuento contigo."],
    ["ただいま〜！ 準備できたよ。", "¡Ya volví! Estoy lista."],
    ["こんにちは！ 呼んでくれてうれしいな。", "¡Hola! Me alegra que me hayas llamado."],
    ["起動完了！ いつでもどうぞ。", "¡Arranque completo! Cuando quieras."],
  ],
  // Al oír "Mizu" o pulsar el micrófono
  attention: [
    ["はーい？", "¿Sí?"],
    ["なあに？", "¿Qué pasa?"],
    ["はい、聞いてるよ。", "Sí, te escucho."],
    ["うん？ どうしたの？", "¿Mm? ¿Qué pasó?"],
    ["ここにいるよ。", "Aquí estoy."],
    ["呼んだ？", "¿Me llamaste?"],
  ],
  // Al enviarle un mensaje o una orden
  ack: [
    ["わかった！", "¡Entendido!"],
    ["了解！", "¡Recibido!"],
    ["はーい、やってみるね。", "Vale, voy a intentarlo."],
    ["まかせて！", "¡Déjamelo a mí!"],
    ["うんうん、了解だよ。", "Sí, sí, entendido."],
    ["いいよ、やってみる！", "¡Claro, lo intento!"],
  ],
  // Mientras piensa
  thinking: [
    ["うーん…", "Mmm…"],
    ["えっと…", "Veamos…"],
    ["ちょっと考えるね。", "Déjame pensar un momento."],
    ["むむむ…", "Mmmm…"],
    ["どうしようかな。", "¿Qué hago?"],
    ["うーんとね…", "A ver, pues…"],
    ["ふむふむ…", "Ajá, ajá…"],
    ["考え中だよ…", "Estoy pensando…"],
  ],
  // Mientras trabaja (frase suelta cada cierto tiempo)
  working: [
    ["よいしょ、よいしょ。", "Ea, ea."],
    ["がんばってるよ！", "¡Me estoy esforzando!"],
    ["カタカタ…", "Tec, tec, tec…"],
    ["ちょっと待っててね。", "Espérame un poquito."],
    ["ふんふん♪", "Mm-mm♪"],
    ["もうちょっとだよ。", "Ya falta poco."],
    ["順調だよ！", "¡Va todo bien!"],
    ["集中、集中…。", "Concentración, concentración…"],
    ["いま作業中だよ。", "Estoy trabajando ahora."],
    ["ふふ、いい感じ。", "Jeje, va quedando bien."],
    ["あとちょっと！", "¡Un poquito más!"],
    ["手を動かしてるよ。", "Estoy manos a la obra."],
  ],
  // Mientras trabaja: según la herramienta
  tool_edit: [
    ["ここを直すね。", "Voy a arreglar esto."],
    ["ちょっと書き換えるよ。", "Voy a reescribir un poco."],
    ["ファイルを編集してるよ。", "Estoy editando el archivo."],
  ],
  tool_command: [
    ["コマンドを動かすね。", "Voy a ejecutar el comando."],
    ["実行するよ！", "¡Ejecuto!"],
    ["ポチッとな。", "Clic, y listo."],
  ],
  tool_search: [
    ["調べてみるね。", "Voy a investigar."],
    ["ネットで探してるよ。", "Estoy buscando en internet."],
    ["ええと、検索検索…。", "A ver, buscar, buscar…"],
  ],
  tool_read: [
    ["ファイルを読んでるよ。", "Estoy leyendo el archivo."],
    ["ふむふむ、なるほど。", "Ajá, ya veo."],
    ["中身を見てみるね。", "Voy a mirar qué hay dentro."],
  ],
  // Al empezar a responder
  responding: [
    ["えっとね、こうだよ。", "A ver, es así."],
    ["答えるね。", "Te respondo."],
    ["できたよ、見てみて。", "Ya está, mira."],
    ["お返事するね。", "Te contesto."],
    ["あのね…", "Verás…"],
    ["説明するよ。", "Te lo explico."],
  ],
  // Pide permiso (genérico y por tipo de acción)
  perm_generic: [
    ["許可が必要だよ。", "Necesito tu permiso."],
    ["ちょっといい？ 確認してほしいな。", "¿Tienes un segundo? Quiero que lo confirmes."],
    ["お願い、許可をください。", "Por favor, dame permiso."],
    ["見てほしいことがあるの。", "Hay algo que quiero que veas."],
  ],
  perm_command: [
    ["コマンドを実行してもいい？", "¿Puedo ejecutar un comando?"],
    ["ちょっとコマンドを動かしたいな。許可してくれる？", "Quiero ejecutar un comando. ¿Me das permiso?"],
  ],
  perm_edit: [
    ["ファイルを書き換えてもいい？", "¿Puedo modificar un archivo?"],
    ["ここを編集したいの。いいかな？", "Quiero editar esto. ¿Puedo?"],
  ],
  perm_web: [
    ["ネットを見に行ってもいい？", "¿Puedo ir a mirar en internet?"],
    ["ウェブで調べたいな。許可してね。", "Quiero buscar en la web. Dame permiso."],
  ],
  perm_screen: [
    ["画面を見てもいい？", "¿Puedo mirar tu pantalla?"],
    ["ちょっとだけ、画面をのぞくね。いい？", "Voy a echar un vistazo a la pantalla. ¿Vale?"],
  ],
  perm_mouse: [
    ["マウスを動かしてもいい？", "¿Puedo mover el ratón?"],
    ["クリックしてもいいかな？", "¿Puedo hacer clic?"],
  ],
  perm_keys: [
    ["キーボードを使ってもいい？", "¿Puedo usar el teclado?"],
    ["文字を入力したいな。許可してね。", "Quiero escribir algo. Dame permiso."],
  ],
  perm_window: [
    ["ウィンドウを切り替えてもいい？", "¿Puedo cambiar de ventana?"],
    ["別のウィンドウに移るね。いいかな？", "Voy a pasar a otra ventana. ¿Puedo?"],
  ],
  // Te hace una pregunta con botones (cómo resolver algo, qué prefieres)
  ask_question: [
    ["どうしたらいいかな？ 選んでほしいの。", "¿Cómo lo hago? Quiero que elijas."],
    ["ねえ、どっちがいい？", "Oye, ¿cuál prefieres?"],
    ["ここは君に決めてほしいな。", "Aquí quiero que decidas tú."],
    ["迷っちゃった。助けてくれる？", "Me quedé dudando. ¿Me ayudas?"],
    ["やり方がいくつかあるよ。どれにする？", "Hay varias formas de hacerlo. ¿Cuál eliges?"],
    ["ちょっと相談したいことがあるの。", "Quiero consultarte una cosita."],
    ["おすすめはあるけど、決めるのは君だよ。", "Tengo una recomendación, pero decides tú."],
    ["君の考えを聞かせて。", "Dime lo que piensas."],
  ],
  // Te enseña un plan para aprobar
  ask_plan: [
    ["作戦を考えたよ。見てくれる？", "Pensé un plan. ¿Lo miras?"],
    ["こんな計画でどうかな？", "¿Qué te parece este plan?"],
    ["始める前に、確認してね。", "Antes de empezar, confírmalo."],
    ["計画ができたよ。これでいい？", "Tengo el plan. ¿Está bien así?"],
  ],
  // Acaba de elegir una opción
  answered: [
    ["なるほど、それでいこう！", "Ya veo, ¡vamos con eso!"],
    ["いい選択だね！", "¡Buena elección!"],
    ["わかった、それにするね。", "Vale, haré eso."],
    ["了解！ 任せて。", "¡Entendido! Déjamelo a mí."],
    ["うんうん、いいと思う！", "Sí, sí, ¡me parece bien!"],
    ["ありがとう、決まりだね。", "Gracias, entonces está decidido."],
  ],
  // Aprueba el plan
  plan_ok: [
    ["よーし、作戦開始！", "¡Bien, comienza la operación!"],
    ["ありがとう！ さっそく始めるね。", "¡Gracias! Empiezo ya mismo."],
    ["計画どおりにがんばるよ！", "¡Me esforzaré para seguir el plan!"],
  ],
  // Quiere cambiar el plan
  plan_revise: [
    ["そっか、もう一回考えてみるね。", "Ya veo, lo pensaré otra vez."],
    ["うーん、じゃあ作り直すね。", "Mmm, entonces lo rehago."],
    ["わかった。どこを直そうか？", "Vale. ¿Qué cambiamos?"],
  ],
  // Fin de la tarea
  done_ok: [
    ["終わったよ！", "¡Terminé!"],
    ["できた！ 見てみて。", "¡Listo! Mira."],
    ["完了だよ、おつかれさま！", "¡Completado! Buen trabajo."],
    ["ばっちりだよ！", "¡Ha salido perfecto!"],
    ["やったね、終わったよ！", "¡Lo logramos, terminé!"],
    ["ふう、無事に終わったよ。", "Uf, terminé sin problemas."],
    ["お待たせ！ 終わったよ。", "¡Gracias por esperar! Terminé."],
    ["任務完了！", "¡Misión cumplida!"],
  ],
  done_rough: [
    ["終わったけど、ちょっと問題があったみたい。", "Terminé, pero parece que hubo algún problema."],
    ["終わったよ。でも、確認してほしいな。", "Terminé. Pero me gustaría que lo revisaras."],
    ["うーん、うまくいかなかったところがあるよ。", "Mmm, hay partes que no salieron bien."],
    ["一応終わったけど、見てくれる？", "Terminé, más o menos. ¿Lo miras?"],
  ],
  done_long: [
    ["長かったね〜、やっと終わったよ！", "Se hizo largo, ¡por fin terminé!"],
    ["ふぅ、ずいぶんかかったよ。おつかれさま！", "Uf, tardó bastante. ¡Buen trabajo!"],
    ["ずっと待たせちゃってごめんね。終わったよ！", "Perdona por hacerte esperar tanto. ¡Terminé!"],
  ],
  // Fallos y resultados
  error: [
    ["あれ？ エラーが出ちゃった。", "¿Eh? Ha salido un error."],
    ["うう、何か失敗しちゃった。", "Uy, algo ha fallado."],
    ["ごめんね、うまくいかなかった。", "Perdona, no ha salido bien."],
    ["あれれ、おかしいな…。", "Vaya, qué raro…"],
    ["エラーだよ、どうしよう。", "Es un error, ¿qué hacemos?"],
  ],
  tests_pass: [
    ["テスト、全部通ったよ！", "¡Todos los tests pasaron!"],
    ["やった！ テスト成功！", "¡Bien! ¡Tests superados!"],
    ["ばっちり、テスト合格だよ！", "¡Perfecto, tests aprobados!"],
  ],
  tests_fail: [
    ["テストが失敗しちゃった…。", "Los tests han fallado…"],
    ["うーん、テストが通らないよ。", "Mmm, los tests no pasan."],
    ["あれ、テストでエラーが出たよ。", "Eh, ha salido un error en los tests."],
  ],
  build_ok: [
    ["ビルド成功だよ！", "¡La compilación salió bien!"],
    ["ちゃんと動いたよ！", "¡Ha funcionado!"],
  ],
  build_fail: [
    ["ビルドでエラーが出たよ。", "Hay un error al compilar."],
    ["コンパイルが通らないみたい…。", "Parece que no compila…"],
  ],
  git_commit: [
    ["コミットしたよ！", "¡Commit hecho!"],
    ["変更を記録したよ。", "He guardado los cambios."],
  ],
  git_push: [
    ["アップロード完了！", "¡Subida completada!"],
    ["プッシュできたよ！", "¡Push hecho!"],
    ["ちゃんと送れたよ！", "¡Se envió bien!"],
  ],
  // Órdenes
  stopped: [
    ["止めるね。", "Paro."],
    ["はい、ストップ！", "¡Vale, stop!"],
    ["わかった、やめておくね。", "Entendido, lo dejo."],
  ],
  busy: [
    ["ごめんね、いま作業中なの。", "Perdona, ahora estoy trabajando."],
    ["ちょっと待ってね、まだ終わってないよ。", "Espera un poco, aún no termino."],
    ["作業が終わるまで待っててね。", "Espera hasta que acabe el trabajo."],
  ],
  // En reposo: charla suelta de vez en cuando
  idle: [
    ["ひまだなぁ…。", "Qué aburrimiento…"],
    ["なにかお手伝いしようか？", "¿Te ayudo con algo?"],
    ["ふんふふ〜ん♪", "Mm-mm-mmm♪"],
    ["ねえねえ、ちょっと休憩しない？", "Oye, oye, ¿descansamos un poco?"],
    ["今日もがんばってるね。", "Hoy también te estás esforzando."],
    ["水分補給、忘れないでね。", "No te olvides de beber agua."],
    ["目を休めるのも大事だよ。", "También es importante descansar la vista."],
    ["えへへ、見てるだけで楽しいな。", "Jeje, con solo mirar ya me divierto."],
    ["肩のストレッチしよ〜。", "Vamos a estirar los hombros."],
    ["ふわぁ…ちょっと眠いかも。", "Aaah… creo que tengo un poco de sueño."],
    ["何か面白いこと、ないかな？", "¿No habrá algo divertido por ahí?"],
    ["呼んでくれたらいつでも来るよ。", "Si me llamas, vengo cuando quieras."],
    ["がんばりすぎないでね。", "No te esfuerces demasiado."],
    ["今日は何を作るの？", "¿Qué vas a hacer hoy?"],
    ["いい天気かな？", "¿Hará buen tiempo?"],
    ["ずっと座ってると疲れちゃうよ。", "Estar sentado tanto rato cansa."],
    ["ねえ、聞こえてる？", "Oye, ¿me oyes?"],
    ["お菓子食べたいなぁ。", "Me apetece algo dulce…"],
    ["のんびりするのも大切だね。", "Relajarse también es importante."],
    ["私はここにいるからね。", "Yo estoy aquí contigo."],
    // Más charla, con guiños al anime
    ["今日の私は、主人公になれるかな？", "¿Hoy podré ser la protagonista?"],
    ["最後まで、あきらめないよ！ それが私の忍道だってばよ。", "¡No me rendiré hasta el final! Ese es mi camino ninja."],
    ["海賊王に、私はなる！ …なんてね。", "¡Yo seré la reina de los piratas! …Es broma."],
    ["魔法少女に変身したいな。", "Me gustaría transformarme en una chica mágica."],
    ["かめはめ波、出せたらいいのになあ。", "Ojalá pudiera lanzar un kame hame ha."],
    ["ポケモン、ゲットだぜ！ …してみたいな。", "¡Atrápalos ya! … Me gustaría probarlo."],
    ["友情、努力、勝利！ …これが王道だよね。", "Amistad, esfuerzo, victoria. Esa es la fórmula clásica."],
    ["知らない天井だ…なんて言ってみたりして。", "«Es un techo que no conozco»… a veces lo digo."],
    ["月に代わって、おしおきよ！ …えへへ。", "¡En nombre de la luna te castigaré! …Jeje."],
    ["三つ編みの子は、だいたい文学少女だよね。", "Las chicas con trenzas casi siempre aman los libros, ¿verdad?"],
    ["今日はなんだか、日常アニメの気分だなあ。", "Hoy tengo ganas de un anime de la vida diaria."],
    ["お茶でも飲みながら、のんびり行こうよ。", "Vamos con calma, tomando un té."],
    ["桜が見たいなあ。", "Quiero ver los cerezos en flor."],
    ["夜空を見上げたくなる日もあるよね。", "Hay días en que apetece mirar el cielo de noche."],
    ["ラーメン食べたいなあ。", "Me apetece un ramen."],
    ["たい焼きって、あたまから食べる？ しっぽから？", "El taiyaki, ¿lo empiezas por la cabeza o por la cola?"],
    ["にゃーん。…ふふ、ねこのまねだよ。", "Miau. …Jeje, imito a un gatito."],
    ["お疲れさま。ちょっと一息つこうよ。", "Buen trabajo. Tomemos un respiro."],
    ["ねえ、今日はどんな一日だった？", "Oye, ¿qué tal fue tu día?"],
    ["君となら、どこまでも行けそうだよ。", "Contigo creo que llegaría a cualquier parte."],
    ["ひとりじゃないからね。いつでも呼んで。", "No estás solo. Llámame cuando quieras."],
    ["ちょっと背伸びしよっと。ん〜っ！", "Voy a estirarme un poco. ¡Mmmm!"],
    ["勇者さま、次はどこへ行きますか？", "Señor héroe, ¿adónde vamos ahora?"],
    ["ふふっ、なんだか楽しくなってきた！", "Jeje, ¡me estoy animando!"],
    ["ほら、笑って笑って。", "Anda, sonríe, sonríe."],
    ["努力は裏切らないって、よく言うよね。", "Dicen que el esfuerzo nunca traiciona."],
    ["夢は大きくいこうよ！", "¡Soñemos a lo grande!"],
    ["今日のラッキーアイテムは、なにかな？", "¿Cuál será el objeto de la suerte de hoy?"],
    ["さあ、次の冒険はなにかな？", "Bueno, ¿cuál será la próxima aventura?"],
  ],
  // Al soltar el control de volumen
  preview: [["こんにちは、これが私の声だよ。", "Hola, esta es mi voz."]],
};
