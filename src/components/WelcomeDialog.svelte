<script lang="ts">
  import { trapFocus } from './focusTrap';

  interface Props {
    returnFocusTo: HTMLElement | null;
    onclose: () => void;
    onacknowledge: () => void;
  }

  let { returnFocusTo, onclose, onacknowledge }: Props = $props();
  let acknowledgeButton: HTMLButtonElement | undefined = $state();

  $effect(() => {
    acknowledgeButton?.focus();
  });

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onclose();
    }
  }

  function onBackdropMousedown(event: MouseEvent): void {
    if (event.target === event.currentTarget) onclose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="backdrop" role="presentation" onmousedown={onBackdropMousedown}>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="welcome-title" use:trapFocus={returnFocusTo}>
    <header class="dialog-header">
      <div class="brand-mark" aria-hidden="true">P</div>
      <div>
        <p class="eyebrow">PIXEL EDITOR · КРАТКОЕ РУКОВОДСТВО</p>
        <h2 id="welcome-title">Добро пожаловать!</h2>
      </div>
      <button type="button" class="btn close" aria-label="Закрыть приветствие" onclick={onclose}>×</button>
    </header>

    <main class="guide-content">
      <section class="intro" aria-labelledby="intro-title">
        <p class="intro-kicker">ПИКСЕЛЬНАЯ ГРАФИКА · СЛОИ · АНИМАЦИЯ</p>
        <h3 id="intro-title">Основные разделы и возможности редактора</h3>
        <p>Краткий обзор поможет быстро сориентироваться в интерфейсе. Подробный перечень сочетаний клавиш находится в окне «Горячие клавиши».</p>
      </section>

      <section class="quickstart" aria-label="Быстрый старт">
        <div class="section-heading">
          <span class="section-index">01</span>
          <div><h3>Быстрый старт</h3><p>Четыре шага от настройки холста до готовой работы</p></div>
        </div>
        <ol class="steps">
          <li><span>1</span><p><strong>Задайте размер.</strong> Выберите пресет или укажите ширину и высоту на панели холста.</p></li>
          <li><span>2</span><p><strong>Выберите инструмент и цвет.</strong> Инструменты расположены слева, цвета и палитры — справа.</p></li>
          <li><span>3</span><p><strong>Работайте с изображением.</strong> Рисуйте на холсте, добавляйте слои или переключитесь в режим анимации.</p></li>
          <li><span>4</span><p><strong>Сохраните результат.</strong> Сохраните проект для продолжения работы или экспортируйте изображение.</p></li>
        </ol>
      </section>

      <section class="guide-section" aria-labelledby="menus-title">
        <div class="section-heading">
          <span class="section-index">02</span>
          <div><h3 id="menus-title">Главное меню</h3><p>Команды сгруппированы по задачам</p></div>
        </div>
        <div class="guide-grid">
          <article class="guide-card">
            <h4>Файл</h4>
            <p>Откройте проект JSON или изображение, сохраните проект для последующего редактирования либо экспортируйте готовую работу.</p>
          </article>
          <article class="guide-card">
            <h4>Правка</h4>
            <p>Отменяйте и повторяйте действия; создавайте выделения, копируйте, вырезайте, перемещайте, отражайте, поворачивайте и масштабируйте их. Здесь же можно обрезать или очистить холст.</p>
          </article>
          <article class="guide-card">
            <h4>Вид и Изображение</h4>
            <p>Управляйте сеткой и масштабом, центрируйте или вписывайте холсты в окно. Откройте отдельное окно предпросмотра.</p>
          </article>
          <article class="guide-card">
            <h4>Слой</h4>
            <p>Добавляйте, дублируйте и удаляйте активный слой. Порядок, видимость, прозрачность, группы и свойства доступны на панели Layers.</p>
          </article>
          <article class="guide-card">
            <h4>Кадр и Анимация</h4>
            <p>Переключайте, добавляйте, дублируйте и удаляйте кадры; запускайте воспроизведение. На Timeline настраивается длительность каждого кадра.</p>
          </article>
          <article class="guide-card">
            <h4>Инструменты и Окно</h4>
            <p>Выбирайте инструмент, рабочее пространство и видимые панели. Доступны режимы «Рисование», «Анимация», «Tileset» и «Минимальное».</p>
          </article>
          <article class="guide-card">
            <h4>Справка</h4>
            <p>Откройте горячие клавиши, заметки обратной связи, это приветствие или настройки приложения.</p>
          </article>
        </div>
      </section>

      <section class="guide-section" aria-labelledby="workspace-title">
        <div class="section-heading">
          <span class="section-index">03</span>
          <div><h3 id="workspace-title">Рабочая область</h3><p>Основные панели редактора</p></div>
        </div>
        <div class="guide-grid">
          <article class="guide-card">
            <h4>Холст и верхняя панель</h4>
            <p>В центре находится холст; на нём можно разместить несколько холстов проекта. На верхней панели — отмена и повтор, экспорт, приветствие, настройки и справка.</p>
          </article>
          <article class="guide-card">
            <h4>Инструменты · слева</h4>
            <p>Карандаш, ластик, заливка, пипетка, линия и фигуры, а также градиент и дизеринг. Наведите указатель на инструмент, чтобы увидеть его название и сочетание клавиш.</p>
          </article>
          <article class="guide-card">
            <h4>Палитра · справа</h4>
            <p>Выбирайте основной и дополнительный цвета, меняйте их местами, переключайте встроенные или пользовательские палитры и добавляйте собственные цвета.</p>
          </article>
          <article class="guide-card">
            <h4>Вкладки правой панели</h4>
            <p>Colors, Palette, Layers, Properties, Brush Settings, Reference, History, Navigator, Preview, Brush Library, Grid Settings и Export открывают соответствующие параметры и инструменты.</p>
          </article>
          <article class="guide-card">
            <h4>Рабочее пространство</h4>
            <p>Переключайте готовые расположения панелей для рисования, анимации, Tileset или минимального интерфейса. Инструменты, палитру и Timeline можно показывать или скрывать отдельно.</p>
          </article>
          <article class="guide-card">
            <h4>Строка состояния</h4>
            <p>Внизу отображаются координаты курсора, размеры холста, масштаб и состояние автосохранения.</p>
          </article>
        </div>
      </section>

      <section class="guide-section" aria-labelledby="canvas-title">
        <div class="section-heading">
          <span class="section-index">04</span>
          <div><h3 id="canvas-title">Холст, цвет и точность</h3><p>Настройте рабочее поле под задачу</p></div>
        </div>
        <div class="guide-grid">
          <article class="guide-card">
            <h4>Размер и масштаб</h4>
            <p>Выберите стандартный или сохранённый размер, задайте пользовательские ширину и высоту. Используйте колесо мыши для масштаба, а кнопки «Вписать», «Центр» и «100%» — для управления видом.</p>
          </article>
          <article class="guide-card">
            <h4>Сетка и отображение</h4>
            <p>Включайте пиксельную, квадратную или изометрическую сетку и задавайте её шаг. В настройках вида доступны шахматный фон прозрачности, привязка, повтор холста и оси симметрии.</p>
          </article>
          <article class="guide-card">
            <h4>Цвет и кисть</h4>
            <p>Левая кнопка мыши задаёт основной цвет, правая — дополнительный. Для рисующих инструментов настраивайте размер, форму и параметры кисти; дополнительные параметры зависят от выбранного инструмента.</p>
          </article>
          <article class="guide-card">
            <h4>Референсы и Tilemap</h4>
            <p>Импортируйте изображения в менеджер референсов, чтобы сверяться с ними во время работы. Редактор Tilemap помогает собирать карту из повторяемых фрагментов изображения.</p>
          </article>
        </div>
      </section>

      <section class="guide-section" aria-labelledby="output-title">
        <div class="section-heading">
          <span class="section-index">05</span>
          <div><h3 id="output-title">Слои, анимация и результат</h3><p>Инструменты для каждого этапа работы</p></div>
        </div>
        <div class="guide-grid">
          <article class="guide-card">
            <h4>Слои</h4>
            <p>Разделяйте части рисунка, меняйте порядок слоёв, объединяйте их в группы и управляйте видимостью, блокировкой, непрозрачностью, режимом смешивания и эффектами.</p>
          </article>
          <article class="guide-card">
            <h4>Кадры и Timeline</h4>
            <p>В рабочем пространстве «Анимация» редактируйте кадры независимо друг от друга. Выберите кадр на Timeline, задайте длительность и проверьте результат воспроизведением.</p>
          </article>
          <article class="guide-card">
            <h4>Сохранение и экспорт</h4>
            <p>Проект сохраняет данные для дальнейшего редактирования; экспорт создаёт готовое изображение. Выберите формат и масштаб в меню файла. Автосохранение сохраняет текущую работу между действиями.</p>
          </article>
          <article class="guide-card">
            <h4>Настройки и горячие клавиши</h4>
            <p>В настройках выберите тему, фон холста и сочетания клавиш. Полный список текущих назначений и подсказки находятся в окне «Горячие клавиши».</p>
          </article>
        </div>
      </section>

      <section class="feedback" aria-labelledby="feedback-title">
        <div class="feedback-icon" aria-hidden="true">✦</div>
        <div>
          <h3 id="feedback-title">Обратная связь</h3>
          <p>В разделе <strong>Справка → Заметки обратной связи</strong> можно записать ошибки и сбои, идеи новых функций, предложения по улучшению или другие замечания. Заметки хранятся локально в одном TXT-файле; их можно просматривать и редактировать. Интернет не требуется.</p>
        </div>
      </section>
    </main>

    <footer class="dialog-footer">
      <span>Приветствие всегда можно открыть кнопкой <kbd>i</kbd> рядом с настройками.</span>
      <button type="button" class="btn primary" bind:this={acknowledgeButton} onclick={onacknowledge}>Начать работу</button>
    </footer>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 125;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: rgba(5, 6, 10, 0.68);
    backdrop-filter: blur(3px);
  }

  .dialog {
    display: flex;
    flex-direction: column;
    width: min(900px, 100%);
    max-height: min(850px, 94dvh);
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: var(--panel);
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
  }

  .dialog-header {
    display: flex;
    flex: none;
    align-items: center;
    gap: 12px;
    padding: 20px 24px;
    border-bottom: 1px solid var(--border);
  }

  .brand-mark {
    display: grid;
    flex: none;
    width: 42px;
    height: 42px;
    place-items: center;
    border-radius: 11px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 22px;
    font-weight: 700;
  }

  .eyebrow {
    margin: 0 0 3px;
    color: var(--text-dim);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
  }

  .dialog-header h2 {
    margin: 0;
    font-size: 19px;
    font-weight: 650;
  }

  .close {
    width: 32px;
    height: 32px;
    margin-left: auto;
    padding: 0;
    font-size: 22px;
  }

  .guide-content {
    display: grid;
    gap: 20px;
    overflow-y: auto;
    padding: 22px 24px;
    scrollbar-gutter: stable;
  }

  .intro { padding: 2px 0 4px; }
  .intro-kicker {
    margin: 0 0 7px;
    color: var(--text-dim);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
  }

  .intro h3 {
    margin: 0 0 7px;
    font-size: clamp(18px, 2.4vw, 23px);
    letter-spacing: -0.02em;
  }

  .intro > p:last-child {
    max-width: 700px;
    margin: 0;
    color: var(--text-dim);
    line-height: 1.55;
  }

  .quickstart {
    padding: 16px;
    border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
    border-radius: 12px;
    background: linear-gradient(115deg, var(--accent-soft), var(--panel-2) 68%);
  }

  .section-heading {
    display: flex;
    align-items: flex-start;
    gap: 11px;
  }

  .section-index {
    display: grid;
    flex: none;
    width: 28px;
    height: 28px;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--panel);
    color: var(--accent);
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 700;
  }

  .section-heading h3,
  .feedback h3 {
    margin: 1px 0 3px;
    font-size: 14px;
  }

  .section-heading p {
    margin: 0;
    color: var(--text-dim);
    font-size: 11px;
  }

  .steps {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
    margin: 16px 0 0;
    padding: 0;
    list-style: none;
  }

  .steps li {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }

  .steps li > span {
    display: grid;
    flex: none;
    width: 20px;
    height: 20px;
    place-items: center;
    border-radius: 50%;
    background: var(--accent);
    color: #fff;
    font-size: 10px;
    font-weight: 700;
  }

  .steps p {
    margin: 0;
    font-size: 11px;
    line-height: 1.5;
  }

  .steps strong,
  .feedback strong { color: var(--text); }

  .guide-section {
    display: grid;
    gap: 11px;
  }

  .guide-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .guide-card {
    min-width: 0;
    padding: 12px 13px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--panel-2);
  }

  .guide-card h4 {
    margin: 0 0 5px;
    font-size: 12px;
    font-weight: 650;
  }

  .guide-card p {
    margin: 0;
    color: var(--text-dim);
    font-size: 11px;
    line-height: 1.55;
  }

  .feedback {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 14px 16px;
    border: 1px solid var(--border);
    border-radius: 11px;
    background: var(--panel-2);
  }

  .feedback-icon {
    display: grid;
    flex: none;
    width: 28px;
    height: 28px;
    place-items: center;
    border-radius: 8px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 14px;
  }

  .feedback h3 { margin-bottom: 5px; }
  .feedback p {
    margin: 0;
    color: var(--text-dim);
    font-size: 11px;
    line-height: 1.55;
  }

  .dialog-footer {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 24px;
    border-top: 1px solid var(--border);
    background: var(--panel);
  }

  .dialog-footer > span {
    color: var(--text-dim);
    font-size: 11px;
    line-height: 1.4;
  }

  kbd {
    display: inline-grid;
    width: 19px;
    height: 19px;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--bg);
    color: var(--text);
    font-family: var(--mono);
    font-size: 11px;
  }

  @media (max-width: 720px) {
    .guide-content { gap: 16px; padding: 16px; }
    .dialog-header { padding: 15px 16px; }
    .steps { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .guide-grid { grid-template-columns: 1fr; }
    .dialog-footer { align-items: flex-start; padding: 12px 16px; }
  }

  @media (max-width: 460px) {
    .backdrop { padding: 8px; }
    .dialog { max-height: 96dvh; }
    .dialog-header h2 { font-size: 17px; }
    .eyebrow { font-size: 9px; letter-spacing: 0.06em; }
    .steps { grid-template-columns: 1fr; }
    .dialog-footer { align-items: stretch; flex-direction: column; }
    .dialog-footer .btn { align-self: flex-end; }
  }
</style>
