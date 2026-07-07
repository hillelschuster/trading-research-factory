
<!DOCTYPE html>
<html lang="en">
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, minimum-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <meta http-equiv="x-dns-prefetch-control" content="on">

  <meta name="robots" content="max-snippet:250,max-image-preview:large">
  <meta name="description" content="Global market sessions shape the rhythm of the trading day, and understanding their overlap is vital to timing entries and exits. In this article, we’ll build an interactive&#x202F;trading&#x202F;sessions&#x202F;&#x202F;EA that brings those global hours to life directly on your chart. The EA automatically plots color‑coded rectangles for the Asia,&#x202F;Tokyo,&#x202F;London,&#x202F;and&#x202F;New&#x202F;York sessions, updating in real time as each market opens or closes. It features on‑chart toggle buttons, a dynamic information panel, and a scrolling ticker headline that streams live status and breakout messages. Tested on different brokers, this EA combines precision with style—helping traders see volatility transitions, identify cross‑session breakouts, and stay visually connected to the global market’s pulse.">
  <meta property="og:url" content="https://www.mql5.com/en/articles/19944">
  <meta property="og:title" content="Price Action Analysis Toolkit Development (Part 47): Tracking Forex Sessions and Breakouts in MetaTrader 5">
  <meta property="og:description" content="Global market sessions shape the rhythm of the trading day, and understanding their overlap is vital to timing entries and exits. In this article, we’ll build an interactive&#x202F;trading&#x202F;sessions&#x202F;&#x202F;EA that brings those global hours to life directly on your chart. The EA automatically plots color‑coded rectangles for the Asia,&#x202F;Tokyo,&#x202F;London,&#x202F;and&#x202F;New&#x202F;York sessions, updating in real time as each market opens or closes. It features on‑chart toggle buttons, a dynamic information panel, and a scrolling ticker headline that streams live status and breakout messages. Tested on different brokers, this EA combines precision with style—helping traders see volatility transitions, identify cross‑session breakouts, and stay visually connected to the global market’s pulse.">
      <meta property="og:image" content="https://c.mql5.com/2/177/19944-price-action-analysis-toolkit-development-part-47-tracking_1200x628.jpg">
      <meta property="og:image:secure_url" content="https://c.mql5.com/2/177/19944-price-action-analysis-toolkit-development-part-47-tracking_1200x628.jpg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:type" content="article">
  <meta property="article:published_time" content="2025-10-27T09:43:49.0000000Z">
  <meta property="article:author" content="https://www.mql5.com/en/users/lynnchris">
  <meta property="article:section" content="MetaTrader 5">
  <meta property="article:tag" content="Trading systems">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:site" content="@mql5com">
  <meta name="twitter:image" content="https://c.mql5.com/2/177/19944-price-action-analysis-toolkit-development-part-47-tracking_1200x628.jpg">
  <meta name="theme-color" content="#4a76b8">
  <meta name="format-detection" content="telephone=no">
  <meta name="msapplication-config" content="none">
  <meta name="referrer" content="no-referrer-when-downgrade">
  <meta property="qc:admins" content="36367170677651456375">
  <meta property="wb:webmaster" content="073d7690269bcd81">
  <link rel="shortcut icon" href="https://c.mql5.com/i/favicon4.ico">
  <link rel="dns-prefetch" href="https://c.mql5.com">
  <link href="https://c.mql5.com/styles/core.12c33e0c5c2361f8dac842e06a673a9b.css" type="text/css" rel="stylesheet" media="all">
  <link href="https://c.mql5.com/styles/all.dbb26ac20a815cc476f3fc7cfca58371.css" type="text/css" rel="stylesheet" media="all">
  <link href="https://c.mql5.com/styles/articles.ff7de5e586ef5f2543cc154983cd5987.css" type="text/css" rel="stylesheet" media="all">
  <link href="/en/articles/rss" rel="alternate" type="application/rss+xml" title="Articles on the development and application of MetaTrader 5 trading robots and technical indicators">
  <link rel="canonical" href="https://www.mql5.com/en/articles/19944">
  <link rel="alternate" hreflang="en" href="https://www.mql5.com/en/articles/19944">
  <link rel="alternate" hreflang="ru" href="https://www.mql5.com/ru/articles/19944">
  <link rel="alternate" hreflang="de" href="https://www.mql5.com/de/articles/19944">
  <link rel="alternate" hreflang="ja" href="https://www.mql5.com/ja/articles/19944">
  <title>Price Action Analysis Toolkit Development (Part 47): Tracking Forex Sessions and Breakouts in MetaTrader 5 - MQL5 Articles</title>



<script type="text/javascript">
  !function(){window.mqGlobal={};var t=!1,n=!1,e=[],o=[],i=[];function d(t){var n;for(n=0;n<t.length;n+=1)t[n]()}function c(){t||(t=!0,d(e),d(o),o=[],e=[])}function a(){c(),n||(n=!0,d(i),i=[])}if(mqGlobal.AddOnReady=function(n,i){t?n(document):i?e.push(n):o.push(n)},mqGlobal.AddOnLoad=function(t){n?t(document):i.push(t)},mqGlobal.AddOnActiveWindowChange=function(t){this._onvisibility||(this._onvisibility=[]),this._onvisibility[this._onvisibility.length]=t},document.addEventListener)document.addEventListener("DOMContentLoaded",c,!1),window.addEventListener("load",a,!1);else if(document.attachEvent&&(document.attachEvent("onreadystatechange",(function(){switch(document.readyState){case"interactive":c();break;case"complete":a()}})),window.attachEvent("onload",a),document.documentElement.doScroll&&window==window.top)){!function n(){if(!t&&document.body)try{document.documentElement.doScroll("left"),c()}catch(t){setTimeout(n,0)}}()}}();
  mqGlobal.CookieDomain = ".mql5.com";
  mqGlobal.Language = 'en';
  mqGlobal.IsMobile = false;
  mqGlobal.ClearRteStorage = function (e) { if (window.GStorage || (window.GStorage = globalStorage()), window.GStorage.supported) try { var o = e; window.GStorage.getItem("rte_autosave_uid", function (e, t) { t == o && (window.GStorage.removeItem("rte_autosave_text"), window.GStorage.removeItem("rte_autosave_date"), window.GStorage.removeItem("rte_autosave_uid")) }) } catch (e) { } };
</script>
  

    <script src="https://c.mql5.com/js/all.369f183966bff4c0fe24e56446b7cc6b.js" type="text/javascript" defer="defer"></script>
  <script src="https://c.mql5.com/js/vendor.39da41eb444456418e5e53cc110d1b68.js" type="text/javascript" defer="defer"></script>
  <script src="https://c.mql5.com/js/articles.cd4c73c476b2781eecdf04f5583514b5.js" type="text/javascript" defer="defer"></script>


</head>

<body id="cover" class="cover">


  <nav class="head">
    <a href="https://www.mql5.com" class="head__logo" title="MQL5 - Language of trade strategies built-in the MetaTrader 5 client terminal"></a>
      <div class="head__content">
        <div class="main-menu" id="mainmenu">
          
                    <ul class="main-menu__top-level" id="menuTopLevel">
                    <li><a href="/en/forum" data-fz-event="MQL5+Menu+Forum">Forum</a></li>
                    <li><a href="/en/market" data-fz-event="MQL5+Menu+Market">Market</a></li>
                    <li><a href="/en/signals" data-fz-event="MQL5+Menu+Signals">Signals</a></li>
                    <li><a href="/en/job" data-fz-event="MQL5+Menu+Job">Freelance</a></li>
                    <li><a href="/en/vps" data-fz-event="MQL5+Menu+VPS">VPS</a></li>
                    <li><a href="/en/quotes/overview" data-fz-event="MQL5+Menu+Overview">Quotes</a></li>
                    <li><a href="https://www.metatrader.com" target="_blank" rel="noopener" data-fz-event="MQL5+Menu+MetaTrader">MetaTrader</a></li>
                  </ul><ul class="main-menu__second-level" id="menuSecondLevel">
                    <li class="main-menu__selected"><a href="/en/articles" data-fz-event="MQL5+Menu+Articles"><img src="https://c.mql5.com/i/menu/icon-articles4.svg" alt="" width="16" height="16"/>Articles</a></li>
                    <li><a href="/en/code" data-fz-event="MQL5+Menu+CodeBase"><img src="https://c.mql5.com/i/menu/icon-code4.svg" alt="" width="16" height="16"/>CodeBase</a></li>
                    <li><a href="https://forge.mql5.io/?lang=en" target="_blank" rel="noopener" data-fz-event="MQL5+Menu+AlgoForge"><img src="https://c.mql5.com/i/menu/icon-algoforge4.svg" alt="" width="16" height="16"/>Algo Forge</a></li>
                    <li><a href="/en/docs" data-fz-event="MQL5+Menu+Docs"><img src="https://c.mql5.com/i/menu/icon-docs4.svg" alt="" width="16" height="16"/>Documentation</a></li>
                    <li><a href="/en/book" data-fz-event="MQL5+Menu+Book"><img src="https://c.mql5.com/i/menu/icon-book4.svg" alt="" width="16" height="16"/>AlgoBook</a></li>
                    <li><a href="/en/neurobook" data-fz-event="MQL5+Menu+Neurobook"><img src="https://c.mql5.com/i/menu/icon-neurobook4.svg" alt="" width="16" height="16"/>NeuroBook</a></li>
                    <li><a href="/en/economic-calendar" data-fz-event="MQL5+Menu+Economic+Calendar"><img src="https://c.mql5.com/i/menu/icon-economic-calendar4.svg" alt="" width="16" height="16"/>Calendar</a></li>
                    <li><a href="https://web.metatrader.app/terminal?mode=demo&lang=en" target="_blank" rel="nofollow noopener" data-fz-event="MQL5+Menu+Trading"><img src="https://c.mql5.com/i/menu/icon-trading4.svg" alt="" width="16" height="16"/>WebTerminal</a></li>
                    <li class="main-menu__mobile"><a href="/en/about">About</a></li>
                    <li class="main-menu__second-tools"><a rel="noopener" target="_blank" href="https://t.me/mql5dev" title="Follow us on socials for top articles and CodeBase updates" class="button-mt" data-vars-fz="Algo+Trading+Channel+Submenu"><img width="18" height="18" src="https://c.mql5.com/i/sidebar/tg.svg" alt="" loading="lazy">Algo Trading Channel</a></li>
                    </ul>
        </div>
          <div class="main-menu__active">
            <a id="mainMenuSelected" href="#">
              <span class="main-menu__primary">Articles</span><span class="main-menu__secondary">Sections</span>
            </a>
          </div>
<form action="https://www.mql5.com/en/search" onsubmit="return false;" autocomplete="off" id="headerSearchForm" class="header-search" method="post">
<button type="button" id="headerSearchButton" title="Search" class="header-search__button"></button><div class="header-search__input"><input name="keyword" type="text" enterkeyhint="search" title="Enter search text" placeholder="Search" id="headerSearchKeyword"/><label for="headerSearchKeyword" class="header-search__placeholder">Type <span>/</span> to search:  @user, $symbol, ...</label><button id="headerSearchSubmit" class="header-search__submit"></button></div><button type="button" id="headerSearchClean" title="Close" class="header-search__clean"></button></form>        <input class="blurHandler" id="mainMenuBlurHandler" type="checkbox">
      </div>
      <div class="head__toolbar" id="headerToolbar">
          <div class="container loginRegister">
            <nav>
              <ul id="loginRegisterButtons"><li><a class="login" title="Please sign in. OpenID supported" href="https://www.mql5.com/en/auth_login" rel="nofollow" data-fz-event="MQL5+Menu+Siginin">Log in</a></li><li><a class="registration en" title="Please register" href="https://www.mql5.com/en/auth_register" rel="nofollow" data-fz-event="MQL5+Menu+Register" onclick="window.fpush('MQL5+Button+Click');">Create an account</a></li></ul>
            </nav>
          </div>
        <div class="toggle-button" id="sidebarToggleButton">
          <i></i>
        </div>

        <div class="group-menu" id="groupMenu">


          <div class="container lang-menu-container">
            <div id="langMenuContainer" class="lang-menu">
              <input class="blurHandler" id="langmenuBlurHandler" type="checkbox">
              <nav>
                <ul class="lang-menu__list" id="langmenu">
                  <li class="lang-menu__list-item lang-menu__list-item_selected"><a href="/en/articles" aria-label="English (English)"><i class="icons-languages icons-languages_en"></i><span>English</span></a></li>
<li class="lang-menu__list-item"><a href="/ru/articles" aria-label="Русский (Russian)"><i class="icons-languages icons-languages_ru"></i><span>Русский</span></a></li>
<li class="lang-menu__list-item"><a href="/zh/articles" aria-label="中文 (Chinese)"><i class="icons-languages icons-languages_zh"></i><span>中文</span></a></li>
<li class="lang-menu__list-item"><a href="/es/articles" aria-label="Español (Spanish)"><i class="icons-languages icons-languages_es"></i><span>Español</span></a></li>
<li class="lang-menu__list-item"><a href="/pt/articles" aria-label="Português (Portuguese)"><i class="icons-languages icons-languages_pt"></i><span>Português</span></a></li>
<li class="lang-menu__list-item"><a href="/ja/articles" aria-label="日本語 (Japanese)"><i class="icons-languages icons-languages_ja"></i><span>日本語</span></a></li>
<li class="lang-menu__list-item"><a href="/de/articles" aria-label="Deutsch (German)"><i class="icons-languages icons-languages_de"></i><span>Deutsch</span></a></li>
<li class="lang-menu__list-item"><a href="/ko/articles" aria-label="한국어 (Korean)"><i class="icons-languages icons-languages_ko"></i><span>한국어</span></a></li>
<li class="lang-menu__list-item"><a href="/fr/articles" aria-label="Français (French)"><i class="icons-languages icons-languages_fr"></i><span>Français</span></a></li>
<li class="lang-menu__list-item"><a href="/it/articles" aria-label="Italiano (Italian)"><i class="icons-languages icons-languages_it"></i><span>Italiano</span></a></li>
<li class="lang-menu__list-item"><a href="/tr/articles" aria-label="Türkçe (Turkish)"><i class="icons-languages icons-languages_tr"></i><span>Türkçe</span></a></li>

                </ul>
              </nav>
            </div>
          </div>
        </div>
      </div>
  </nav>

<div id='bfogggabsofabcpxuzmgaibarmaxasdrj' class="r7cabw4wv6r1wrkd5 g7h2ap3u5"></div>

  <div id="left-sidebar-selector" class="left-sidebar__selector left-sidebar__selector_padding">
    <div class="left-sidebar__title">
MetaTrader 5 /     Trading systems
    </div>
    <i class="icons-ux icons-ux_arrow-down-black"></i>
  </div>
  <div class="articles-container block-with-sidebar">
    <aside class="left-sidebar left-sidebar_270" id="left-sidebar">
      
  <ul class="tree-menu-ul"><li class="tree-menu__item"><a class="tree-menu__link" href="/en/articles/examples"><img class="tree-menu__icon" width="20" height="20" src="https://c.mql5.com/i/sidebar/examples.svg" alt="" loading="lazy"/>Examples</a><ul class="tree-menu__list tree-menu__list_nested"><li class="tree-menu__item"><a class="tree-menu__link" href="/en/articles/examples_indicators"><img class="tree-menu__icon" width="20" height="20" src="https://c.mql5.com/i/sidebar/examples_indicators.svg" alt="" loading="lazy"/>Indicators</a></li><li class="tree-menu__item"><a class="tree-menu__link" href="/en/articles/examples_experts"><img class="tree-menu__icon" width="20" height="20" src="https://c.mql5.com/i/sidebar/examples_experts.svg" alt="" loading="lazy"/>Experts</a></li></ul></li><li class="tree-menu__item"><a class="tree-menu__link" href="/en/articles/strategy_tester"><img class="tree-menu__icon" width="20" height="20" src="https://c.mql5.com/i/sidebar/strategy_tester.svg" alt="" loading="lazy"/>Tester</a></li><li class="tree-menu__item"><a class="tree-menu__link" href="/en/articles/trading"><img class="tree-menu__icon" width="20" height="20" src="https://c.mql5.com/i/sidebar/trading.svg" alt="" loading="lazy"/>Trading</a></li><li class="tree-menu__item tree-menu__item_selected"><a class="tree-menu__link" href="/en/articles/trading_systems"><img class="tree-menu__icon" width="20" height="20" src="https://c.mql5.com/i/sidebar/trading_systems.svg" alt="" loading="lazy"/>Trading systems</a></li><li class="tree-menu__item"><a class="tree-menu__link" href="/en/articles/integration"><img class="tree-menu__icon" width="20" height="20" src="https://c.mql5.com/i/sidebar/integration.svg" alt="" loading="lazy"/>Integration</a></li><li class="tree-menu__item"><a class="tree-menu__link" href="/en/articles/indicators"><img class="tree-menu__icon" width="20" height="20" src="https://c.mql5.com/i/sidebar/indicator.svg" alt="" loading="lazy"/>Indicators</a></li><li class="tree-menu__item"><a class="tree-menu__link" href="/en/articles/expert_advisors"><img class="tree-menu__icon" width="20" height="20" src="https://c.mql5.com/i/sidebar/expert.svg" alt="" loading="lazy"/>Expert Advisors</a></li><li class="tree-menu__item"><a class="tree-menu__link" href="/en/articles/statistics"><img class="tree-menu__icon" width="20" height="20" src="https://c.mql5.com/i/sidebar/statistics.svg" alt="" loading="lazy"/>Statistics and analysis</a></li><li class="tree-menu__item"><a class="tree-menu__link" href="/en/articles/machine_learning"><img class="tree-menu__icon" width="20" height="20" src="https://c.mql5.com/i/sidebar/machine_learning.svg" alt="" loading="lazy"/>Machine learning</a></li><li class="tree-menu__item"><a class="tree-menu__link" href="/en/articles/interviews"><img class="tree-menu__icon" width="20" height="20" src="https://c.mql5.com/i/sidebar/interviews.svg" alt="" loading="lazy"/>Interviews</a></li></ul>
  

    <div class="hints-panel">
      <div class="hints-panel__item">
        <i class="icons-hints icons-hints_like"></i>
        <div class="hints-panel__content">
          Do you like the article?<br>
          Share it with others —<br>post a <a href="https://www.mql5.com/en/articles/19944" target="_blank">link</a> to it!
        </div>
      </div>

      <div class="hints-panel__item">
        <i class="icons-hints icons-hints_fb-square icons-hints_24px"></i><div class="hints-panel__content">
Find us on <a href="https://www.facebook.com/mql5.community/" target="_blank" rel="nofollow">Facebook</a>!<br> Join our fan page</div>
      </div>

      <div class="hints-panel__item">
        <i class="icons-hints icons-hints_mt-5"></i>
        <div class="hints-panel__content">
          Use new possibilities of <a href="https://download.terminal.free/cdn/web/metaquotes.ltd/mt5/mt5setup.exe?utm_source=www.mql5.com&utm_campaign=download" data-fz-event="MetaTrader+5+Desktop+Download+Article" rel="nofollow sponsored noopener noreferrer">MetaTrader 5</a>
        </div>
      </div>
    </div>
<div id='vgckrufggwxdtfscpyalmenexmvhljduja' class="r72fhl8598u19pas6 g7h2ap3u5"></div>      <div class="similar-author-articles ui">
        <h4 class="similar-author-articles__title">Similar articles</h4>
        <ul class="similar-author-articles__list">
            <li>
              <a href="/en/articles/23158" data-fz-event="MQL5+Article+Similar+Article">Feature Engineering for ML (Part 9): Structural Break Tests in Python</a>
            </li>
            <li>
              <a href="/en/articles/18004" data-fz-event="MQL5+Article+Similar+Article">Neural Networks in Trading: Time Series Forecasting Using Adaptive Modal Decomposition (ACEFormer)</a>
            </li>
            <li>
              <a href="/en/articles/22927" data-fz-event="MQL5+Article+Similar+Article">Creating an EMA Crossover Forward Simulation (Culmination): Interactive Synthetic Candles</a>
            </li>
            <li>
              <a href="/en/articles/23202" data-fz-event="MQL5+Article+Similar+Article">MQL5 Wizard Techniques you should know (Part 100): Sliding Window Median and Bidirectional LSTM for a Custom Trailing Stop</a>
            </li>
            <li>
              <a href="/en/articles/19043" data-fz-event="MQL5+Article+Similar+Article">Implementation of the Quantum Reservoir Computing (QRC) circuit</a>
            </li>
        </ul>
      </div>
    <div class="freelance-hint">
      <img src="https://c.mql5.com/i/articles/icon_freelance.svg" width="24" height="24" loading="lazy" />
      <div class="freelance-hint__text">
        Use the ideas from this article<br>to order your own robot<br>on Freelance
      </div>
        <a target="_blank" class="button button_blue-gray-border" title="Go to Freelance" href="/en/job/new" data-fz-event="MQL5+Article+New+Job">Go to Freelance</a>
    </div>

    </aside>
    <article class="content-with-sidebar articles-content splashed">
      


  <header class="article-header article-header_light" style="background-color: rgb(33,46,58)">
    <section class="article-tools-panel">
        <div class="article-tools-panel__item">
          <span class="popup framed client flags">
            <a class="dropdown" href="javascript:void(false);">
              <span class="icons-languages icons-languages_en"></span><i></i>
            </a>
            <span class="popup">
              <span class="tip">
                <span></span>
              </span>
              <span class="items">
                    <a href="/ru/articles/19944">Русский</a>
                    <a href="/de/articles/19944">Deutsch</a>
                    <a href="/ja/articles/19944">日本語</a>
              </span>
            </span>
          </span>
        </div>
        
      <div class="article-tools-panel__item">
        <a href="#pocket" title="Pocket allows you to insert a complete content description to the appropriate comment" onclick="return Pocket.Add(this,'en',2,1,19944);" class="article-tools-panel__rounded">
          <i class="article-pocket-icon"></i>
        </a>
      </div>
      <div class="article-tools-panel__item">
        <a href="/en/articles/19944?print=" target="_blank" class="article-tools-panel__rounded" rel="nofollow" title="Printer friendly version">
          <i class="article-print-icon"></i>
        </a>
      </div>

    </section>
    <section class="article-header__image-box">
        <img class="article-header__image-preview" loading="lazy" width="32" height="16" alt="preview" src="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAsICAoIBwsKCQoNDAsNERwSEQ8PESIZGhQcKSQrKigkJyctMkA3LTA9MCcnOEw5PUNFSElIKzZPVU5GVEBHSEX/2wBDAQwNDREPESESEiFFLicuRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUX/wAARCAAQACADASIAAhEBAxEB/8QAGQAAAgMBAAAAAAAAAAAAAAAAAgQAAwUG/8QAIRAAAQQABgMAAAAAAAAAAAAAAQACAxEEExQxQZEhcYH/xAAWAQEBAQAAAAAAAAAAAAAAAAADAAL/xAAZEQACAwEAAAAAAAAAAAAAAAAAAQIRITH/2gAMAwEAAhEDEQA/AOOGJhaTULOlH4yNzKyhXpZxlrYIc29wka0KGdHtYxtANHjYUqJZmPfZYOkuZRw2vqEyXwt4UnbP/9k=">
      <div class="article-header__gradient" style="background: linear-gradient(90deg, rgba(33,46,58, 1) 0%, rgba(33,46,58, 0.72) 8.31%, rgba(33,46,58, 0) 17.1%), linear-gradient(270deg, rgba(33,46,58, 1) 0%, rgba(33,46,58, 0.72) 8.06%, rgba(33,46,58, 0) 16.59%), linear-gradient(0deg, rgba(33,46,58, 1) 8.26%, rgba(33,46,58, 0.8) 65%, rgba(33,46,58, 0) 100%);"></div>
        <picture>
          <source srcset="https://c.mql5.com/2/177/19944-price-action-analysis-toolkit-development-part-47-tracking_600x314.jpg, https://c.mql5.com/2/177/19944-price-action-analysis-toolkit-development-part-47-tracking_1200x628.jpg 2x" media="(min-width:700px)">
          <img class="article-header__image" loading="lazy" width="600" height="314" srcset="https://c.mql5.com/2/177/19944-price-action-analysis-toolkit-development-part-47-tracking_300x157.jpg, https://c.mql5.com/2/177/19944-price-action-analysis-toolkit-development-part-47-tracking_600x314.jpg 2x" src="https://c.mql5.com/2/177/19944-price-action-analysis-toolkit-development-part-47-tracking_600x314.jpg" alt="Price Action Analysis Toolkit Development (Part 47): Tracking Forex Sessions and Breakouts in MetaTrader 5" onerror="this.style.display='none';">
        </picture>
    </section>
    <section class="article-header__content">
      <h1>Price Action Analysis Toolkit Development (Part 47): Tracking Forex Sessions and Breakouts in MetaTrader 5</h1>
      <div class="article-header__info">
        <a href="/en/articles/mt5">MetaTrader 5</a>
          &mdash;
          <a href="/en/articles/mt5/trading_systems">Trading systems</a>
        | <time datetime="2025-10-27T09:43Z" title="09:43" datetime-type="datetime">27 October 2025, 09:43</time>
      </div>
      <div class="article-header__indicators">
        <span title="Views">
          <img src="https://c.mql5.com/i/icons.svg#views-white-usage" width="20" height="20" alt="" />
          8 995
        </span>
        
          <a title="Comments" href="/en/forum/498771">
            <img src="https://c.mql5.com/i/icons.svg#comments-white-usage" width="20" height="20" alt="" />
            0
          </a>
      </div>
      <div class="article-header__author">
          <div class="article-header__avatar">
            <img src="https://c.mql5.com/avatar/2025/10/68fd3661-daee.png" srcset="https://c.mql5.com/avatar/2025/10/68fd3661-daee_big.png 2x" data-user-login="Lynnchris" title="Christian Benjamin" alt="Christian Benjamin" loading="lazy" width="60" height="60">
          </div>
<a class="author" href="/en/users/lynnchris" data-user-login="Lynnchris">Christian Benjamin</a>      </div>
    </section>
  </header>

    <div class="content">
      <div class="inner formatted-content">
        <h3 id="introduction">Introduction</h3> <p>The foreign‑exchange market operates 24 hours a day, constantly cycling through major financial centers around the globe. Each region brings its own characteristics: the Asia session tends to start the day quietly, Tokyo often provides the first true direction, London injects strong volume and volatility, and New York carries momentum into the late hours with frequent reversals or continuations. Recognizing which of these sessions is currently active allows traders to adapt to changing market speed, volatility, and liquidity. </p> <p>For new traders, keeping track of these sessions can be confusing. Broker server times often differ from local time zones, and manually calculating session boundaries can lead to mistakes. The All Sessions EA solves this by automatically synchronizing to the broker’s server time, displaying accurate session boxes for Asia, Tokyo, London, and New York directly on the chart. This gives beginners a clear visual understanding of how global markets hand over control through the day and how price behavior changes as one session transitions to the next. </p> <p>Beyond simple visualization, the EA includes interactive features such as on‑chart toggle buttons to show or hide sessions, an information panel, and a scrolling headline ticker that reports real‑time events. It also integrates a breakout‑alert system that notifies the user whenever current prices exceed the high or low of a previous session—helping traders anticipate shifts in volatility and trade with greater timing accuracy. With full synchronization, improved readability, and an intuitive layout, the enhanced version also now highlights all four global sessions and uniformly spaced H‑L‑O‑C labels for clear, consistent reference.&nbsp;&nbsp;</p> <p>Read on in this article to learn how to implement these features step by step in MQL5, from designing the interface to building the logic for real‑time monitoring and alerts.</p> <h3><br/></h3> <h3 id="para2">Contents</h3> <ul> <li><a href="/en/articles/19944#introduction">Introduction</a></li> <li><a href="/en/articles/19944#designing_the_tool">Designing the Tool</a></li> <li><a href="/en/articles/19944#building_the_interface">Building the Interface</a></li> <li><a href="/en/articles/19944#implementing_the_logic">Implementing the Logic</a></li> <li><a href="/en/articles/19944#testing_and_validation">Testing and Validation</a></li> <li><a href="/en/articles/19944#conclusion">Conclusion</a></li> </ul> <p> <p><br/></p> <h3 id="designing_the_tool">Designing the Tool</h3> <p>Before constructing the Expert Advisor, it is essential to understand what trading sessions represent and why they are central to market analysis. The 24‑hour Forex market rotates through four main hubs—Asia, Tokyo, London, and New York—each with distinct patterns of liquidity and volatility. Historically, the Asian market tends to be calmer, Tokyo marks the first wave of direction, London drives strong price movements, and New York often finishes the day with momentum or reversals. Because broker servers operate in different time zones, manually identifying these periods on a chart can lead to errors, especially for new traders who may mistake local time for market time. The All Sessions EA removes that complexity by using the broker’s server clock as the reference, ensuring all four sessions appear correctly aligned regardless of time zone differences. It equips traders with a practical, real‑time map of global session activity.</p> <p> <p><u>Purpose of the EA</u></p> <p>This EA is designed to make session analysis visual, interactive, and actionable. </p> <p> <ol> <li><u>Visualize Market Cycles</u>: Automatically draw shaded rectangles for Asia, Tokyo, London, and New York sessions using accurate start and end times.</li> <li><u>Simplify Interaction</u>: Allow users to toggle each session on or off through on‑chart buttons without navigating indicator settings.</li> <li><u>Monitor Key Data Live</u>: Display each session’s open, high, low, and close directly on the chart using clean, evenly spaced text labels.</li> <li><u>Stay Synchronized Automatically</u>: Operate entirely on broker‑server time, never on the user’s computer clock.</li> <li><u>Highlight Trading Signals</u>: Generate instant alerts when the current price breaks above or below the previous session’s range.</li> <li><u>Organize Information</u>: Present quick visual feedback through a top‑right info panel and a scrolling headline ticker that reports events in real time.</li> </ol> <p> <p><u>Interface and Functional Design</u></p> <p>Just like a dashboard, every on‑chart element serves a clear purpose:</p> <table cellspacing="0" cellpadding="3" width="100%" class="standart"> <thead> <tr> <th>Element</th> <th>Type&nbsp;</th> <th>Purpose</th> </tr> </thead> <tbody> <tr> <td>Asia Button</td> <td>OBJ_BUTTON<br/></td> <td>Toggle the visibility of the Asia session rectangle</td> </tr> <tr> <td>Tokyo Button</td> <td>OBJ_BUTTON<br/></td> <td>Toggle the visibility of the Tokyo session rectangle</td> </tr> <tr> <td>London Button</td> <td>OBJ_BUTTON<br/></td> <td>Toggle the visibility of the London session rectangle</td> </tr> <tr> <td>New York Button</td> <td>OBJ_BUTTON<br/></td> <td>Toggle the visibility of the New York session rectangle</td> </tr> <tr> <td>Information Panel</td> <td>OBJ_RECTANGLE_LABEL + OBJ_LABEL <br/></td> <td>Show which sessions are currently active and their states</td> </tr> <tr> <td>Ticker Headline</td> <td>OBJ_LABEL<br/></td> <td>Scroll trading updates and alerts across the bottom of the chart</td> </tr> <tr> <td>Session Rectangles</td> <td>OBJ_RECTANGLE<br/></td> <td>Color‑coded areas representing each session’s trading hours<br/></td> </tr> <tr> <td>Session Labels</td> <td>OBJ_TEXT<br/></td> <td>Display the H / L / O / C values once per session (current day only)<br/></td> </tr> </tbody> </table> <p>Each control is created programmatically with <i>ObjectCreate</i>() and updated dynamically as traders interact or as time passes. The interface remains minimal and responsive even during high‑volatility periods.</p> <p><u>Visual Design</u></p> <p>Clarity and spacing are fundamental. This version increases the vertical offset between session labels to maintain equal gaps—so the text marking London is separated from Tokyo by the same visual distance as Tokyo is from Asia. This uniform spacing prevents overlap and ensures readability regardless of chart scale. A consistent color scheme further differentiates activity zones:&nbsp;&nbsp;</p> <ul> <li>Sky Blue – Asia</li> <li>Light Green – Tokyo</li> <li>Light Pink – London</li> <li>Gold – New York</li> </ul> <p>The scrolling ticker appears at the bottom of the chart and uses the <i>TickerColor </i>input to blend with the trader’s preferred chart palette. A compact black information panel on the upper‑right corner displays current session states using white Arial text for sharp contrast.</p> <p><u>Functional Requirements</u></p> <p>The logic is modular and event‑driven:</p> <table cellspacing="0" cellpadding="3" width="100%" class="standart"> <thead> <tr> <th>Logic</th> <th>Description</th> </tr> </thead> <tbody> <tr> <td>Button Interaction<br/></td> <td>User clicks trigger <i>OnChartEvent</i>(), immediately redrawing sessions and updating the panel.<br/></td> </tr> <tr> <td>Session Computation<br/></td> <td>The EA calculates session start and end times from broker time, scans historical bars for H/L/O/C values, and plots rectangles accordingly.<br/></td> </tr> <tr> <td>Timer Events<br/></td> <td>Every second, the EA refreshes visual elements, scrolls the ticker, and checks for session openings, closings, and breakout conditions.<br/></td> </tr> <tr> <td>&nbsp;Breakout Detection</td> <td>When the current price eclipses the previous session’s extreme, the EA issues an on‑screen and sound alert and posts the event in the ticker headline.<br/></td> </tr> <tr> <td>Resource Efficiency<br/></td> <td>All graphics rely on lightweight OBJ_RECTANGLE and OBJ_TEXT objects—no indicator buffers—keeping CPU usage low.<br/></td> </tr> </tbody> </table> <p><u>Core Logic Concept</u></p>The system follows a simple cyclical logic anchored to broker‑time: <table cellspacing="0" cellpadding="3" width="100%" class="standart"> <thead> <tr> <th>Stages</th> <th>Description</th> </tr> </thead> <tbody> <tr> <td>Initialization stage<br/></td> <td>Creates buttons, panel, and ticker; draws both the previous and current trading days.<br/></td> </tr> <tr> <td>Monitoring stage<br/></td> <td>A one‑second timer continuously checks for session open/close times relative to <i>TimeCurrent</i>() and manages alerts.<br/></td> </tr> <tr> <td>Visualization update<br/></td> <td>Every minute, sessions are redrawn to stay fully synchronized with server time.<br/></td> </tr> <tr> <td>Interaction response<br/></td> <td>Any button press immediately updates visibility and status text.<br/></td> </tr> </tbody> </table> <p>This design keeps the code modular, readable, and extendable—so that later we can add features such as the Sydney session, push notifications, or statistical averages.&nbsp;</p> <p><br/></p> <h3 id="building_the_interface">Building the Interface</h3> <p>A functional interface is the backbone of any interactive EA. Rather than relying on input parameters buried in the settings window, the All Sessions EA places all critical controls directly on the chart. Traders can turn sessions on or off, view information instantly, and follow streaming updates without interrupting live analysis. In MetaTrader 5, graphical components are created with chart objects such as OBJ_BUTTON, OBJ_LABEL, and OBJ_RECTANGLE_LABEL. Each element is defined by position, size, color, and other properties that keep the interface consistent across chart styles.</p> <p><u>Layout Concept</u></p>The chart layout follows a practical visual hierarchy: <table cellspacing="0" cellpadding="3" width="100%" class="standart"> <thead> <tr> <th>Area</th> <th>Elements</th> <th>Description</th> </tr> </thead> <tbody> <tr> <td>Top Left</td> <td>Asia · Tokyo · London · New York toggle buttons</td> <td>Primary user controls. Each acts as an independent switch for its session box.</td> </tr> <tr> <td>Top Right</td> <td>Information Panel</td> <td>Black rectangle showing current on/off status for each session.</td> </tr> <tr> <td>Main Chart Area</td> <td>Colored rectangles + text labels<br/></td> <td>Session time ranges and H/L/O/C data, evenly spaced to prevent overlap.<br/></td> </tr> <tr> <td>Bottom‑left</td> <td>Scrolling ticker headline<br/></td> <td>Live feed displaying alerts and updates.<br/></td> </tr> </tbody> </table> <p>This positioning keeps the price candles central while the interface elements occupy unused margins, ensuring clarity even on smaller screens.</p> <p style="text-align:center;"> <img width="723" height="526" src="https://c.mql5.com/2/176/sessions.png" loading="lazy" alt style="vertical-align:middle;"/></p> <p><u>Creating the Session Buttons</u></p> <p>Each button is created through a helper function:</p> <pre class="code"><span class="keyword">void</span> CreateButton(<span class="keyword">string</span> name,<span class="keyword">string</span> text,<span class="keyword">int</span> x,<span class="keyword">int</span> y,<span class="keyword">color</span> c)
{
&nbsp;&nbsp; <span class="functions">ObjectCreate</span>(<span class="number">0</span>,name,<span class="macro">OBJ_BUTTON</span>,<span class="number">0</span>,<span class="number">0</span>,<span class="number">0</span>);
&nbsp;&nbsp; <span class="functions">ObjectSetInteger</span>(<span class="number">0</span>,name,<span class="macro">OBJPROP_CORNER</span>,<span class="macro">CORNER_LEFT_UPPER</span>);
&nbsp;&nbsp; <span class="functions">ObjectSetInteger</span>(<span class="number">0</span>,name,<span class="macro">OBJPROP_XDISTANCE</span>,x);
&nbsp;&nbsp; <span class="functions">ObjectSetInteger</span>(<span class="number">0</span>,name,<span class="macro">OBJPROP_YDISTANCE</span>,y);
&nbsp;&nbsp; <span class="functions">ObjectSetInteger</span>(<span class="number">0</span>,name,<span class="macro">OBJPROP_XSIZE</span>,<span class="number">110</span>);
&nbsp;&nbsp; <span class="functions">ObjectSetInteger</span>(<span class="number">0</span>,name,<span class="macro">OBJPROP_YSIZE</span>,<span class="number">20</span>);
&nbsp;&nbsp; <span class="functions">ObjectSetInteger</span>(<span class="number">0</span>,name,<span class="macro">OBJPROP_BGCOLOR</span>,<span class="macro">clrDimGray</span>);
&nbsp;&nbsp; <span class="functions">ObjectSetInteger</span>(<span class="number">0</span>,name,<span class="macro">OBJPROP_COLOR</span>,c);
&nbsp;&nbsp; <span class="functions">ObjectSetInteger</span>(<span class="number">0</span>,name,<span class="macro">OBJPROP_FONTSIZE</span>,<span class="number">9</span>);
&nbsp;&nbsp; <span class="functions">ObjectSetString</span> (<span class="number">0</span>,name,<span class="macro">OBJPROP_TEXT</span>,text);
}</pre> <p>Through this routine, four buttons are placed neatly in two rows:</p> <pre class="code">CreateButton(<span class="string">"BTN_ASIA"</span>,<span class="string">"Asia ON/OFF"</span>,<span class="number">10</span>,<span class="number">20</span>,clrSkyBlue);
CreateButton(<span class="string">"BTN_TOKYO"</span>,<span class="string">"Tokyo ON/OFF"</span>,<span class="number">125</span>,<span class="number">20</span>,clrLightGreen);
CreateButton(<span class="string">"BTN_LONDON"</span>,<span class="string">"London ON/OFF"</span>,<span class="number">240</span>,<span class="number">20</span>,clrLightPink);
CreateButton(<span class="string">"BTN_NEWYORK"</span>,<span class="string">"New York ON/OFF"</span>,<span class="number">10</span>,<span class="number">45</span>,clrGold);</pre> <p>Each button triggers an event captured by <i> OnChartEvent</i>().&nbsp;When clicked, it flips the corresponding Boolean (<i>showAsia</i>, <i> showTokyo</i>, etc.), redraws visible sessions, updates the panel, and posts a status message in the ticker headline.&nbsp;This gives traders immediate control without stopping live updates.</p> <p><u>Building the Information Panel</u></p> <p>The right‑hand information box acts as a mini‑dashboard. It’s composed of a background rectangle (<i>OBJ_RECTANGLE_LABEL</i>) and a text label (<i>OBJ_LABEL</i>) that displays the visibility state of each session:</p> <pre class="code">ASIA&nbsp;&nbsp;&nbsp;&nbsp;: ON
TOKYO&nbsp;&nbsp; : OFF
LONDON&nbsp;&nbsp;: ON
NEWYORK : OFF</pre>Programmatically it’s built as follows: <pre class="code"><span class="functions">ObjectCreate</span>(<span class="number">0</span>,<span class="string">"PANEL_BG"</span>,<span class="macro">OBJ_RECTANGLE_LABEL</span>,<span class="number">0</span>,<span class="number">0</span>,<span class="number">0</span>);
<span class="functions">ObjectSetInteger</span>(<span class="number">0</span>,<span class="string">"PANEL_BG"</span>,<span class="macro">OBJPROP_CORNER</span>,<span class="macro">CORNER_RIGHT_UPPER</span>);
<span class="functions">ObjectSetInteger</span>(<span class="number">0</span>,<span class="string">"PANEL_BG"</span>,<span class="macro">OBJPROP_XDISTANCE</span>,<span class="number">360</span>);
<span class="functions">ObjectSetInteger</span>(<span class="number">0</span>,<span class="string">"PANEL_BG"</span>,<span class="macro">OBJPROP_YDISTANCE</span>,<span class="number">20</span>);
<span class="functions">ObjectSetInteger</span>(<span class="number">0</span>,<span class="string">"PANEL_BG"</span>,<span class="macro">OBJPROP_XSIZE</span>,<span class="number">360</span>);
<span class="functions">ObjectSetInteger</span>(<span class="number">0</span>,<span class="string">"PANEL_BG"</span>,<span class="macro">OBJPROP_YSIZE</span>,<span class="number">110</span>);
<span class="functions">ObjectSetInteger</span>(<span class="number">0</span>,<span class="string">"PANEL_BG"</span>,<span class="macro">OBJPROP_BGCOLOR</span>,<span class="macro">clrBlack</span>);</pre> <p>The update routine <i>UpdatePanel</i>() refreshes its content each time a button changes state or a redraw occurs.&nbsp;Keeping this information on screen helps beginners understand which sessions they are currently viewing.</p> <p><u>Creating the Ticker Headline</u></p> <p>The ticker runs along the bottom left corner of the chart, displaying alerts such as “London session opened” or “New York breaks above prior London high.” It’s implemented with an <i>OBJ_LABEL</i> object and scrolled by changing its text every second inside <i>OnTimer</i>():</p> <pre class="code"><span class="functions">ObjectCreate</span>(<span class="number">0</span>,<span class="string">"TICKER_OBJ"</span>,<span class="macro">OBJ_LABEL</span>,<span class="number">0</span>,<span class="number">0</span>,<span class="number">0</span>);
<span class="functions">ObjectSetInteger</span>(<span class="number">0</span>,<span class="string">"TICKER_OBJ"</span>,<span class="macro">OBJPROP_CORNER</span>,<span class="macro">CORNER_LEFT_LOWER</span>);
<span class="functions">ObjectSetInteger</span>(<span class="number">0</span>,<span class="string">"TICKER_OBJ"</span>,<span class="macro">OBJPROP_XDISTANCE</span>,<span class="number">10</span>);
<span class="functions">ObjectSetInteger</span>(<span class="number">0</span>,<span class="string">"TICKER_OBJ"</span>,<span class="macro">OBJPROP_YDISTANCE</span>,<span class="number">18</span>);
<span class="functions">ObjectSetInteger</span>(<span class="number">0</span>,<span class="string">"TICKER_OBJ"</span>,<span class="macro">OBJPROP_COLOR</span>,TickerColor);</pre> <p>A one‑second timer moves text characters across the label, creating a smooth scrolling effect that mimics professional news feeds.</p> <p><u>Managing Readability and Spacing</u></p> <p>When multiple sessions are displayed together, label overlap can occur near the top of the rectangles. To eliminate clutter, this EA introduces a dynamic vertical offset for each label with the formula:</p> <pre class="code"><span class="keyword">double</span> offsetY = (slot + <span class="number">1</span>) * <span class="predefines">_Point</span> * <span class="number">120</span>;</pre> <p>This equal‑spacing multiplier keeps gaps between Asia ↔ Tokyo and Tokyo ↔ London consistent, ensuring identical visual separation across all sessions. It automatically scales with symbol precision (_Point) so labels maintain relative spacing on any instrument.</p> <p><u> Color Palette and Font Choices</u></p> <p>Each session is assigned a distinct tone that allows traders to identify market activity instantly without consulting legends or tooltips. The Asia session appears in Sky Blue, representing the calm, early part of the trading day when price movements are generally measured and stable. The Tokyo session uses Light Green, capturing the sense of renewal as volatility begins to build when Japanese markets open. For London, the color Light Pink has been chosen to contrast strongly with the preceding shades and to mark the period of highest trading intensity as Europe steps in. Finally, the New York session is drawn in Gold, symbolizing late‑day momentum and the transition toward daily closes across global markets.</p> <p>Supporting text elements follow a consistent visual language: all session labels display their own session color, while informational text on the panel and ticker uses a clean white sans‑serif font for readability against dark backgrounds. Font weight and size are deliberately moderate so the interface remains visible yet unobtrusive, even during rapid market movement or when the chart background theme is changed. This combination of clear color coding and careful typography ensures that the EA maintains both clarity and aesthetic balance on any chart.&nbsp;&nbsp;</p> <p>Text uses a sans‑serif font (Arial or system default) in white for panels and in session color for labels. Fonts are bold enough to remain legible against both light and dark chart backgrounds.</p> <p><u>Putting the Interface Together</u></p> <p>At initialization (<i>OnInit</i>()), the EA calls:</p> <pre class="code">CreateButton(... four times …);
CreatePanel();
CreateTicker();
DrawAll();
UpdatePanel();
UpdateTicker(Headline);</pre> <p>This sequence constructs the complete interface as soon as the EA loads. From there, all updates are handled dynamically by the timer and event handlers, so the trader never needs to refresh manually.</p> <p><br/></p> <h3 id="implementing_the_logic">Implementing the Logic</h3> <p>Once the interface is in place, the EA needs the logic that will make it think, react, and remain synchronized with the real market. The goal is to let traders watch, in real time, how the global trading day unfolds—from Asia to Tokyo, through London, and finally to New York — while the EA automatically draws each session, reports activity, and alerts on breakout opportunities. This section walks through every part of that logic in detail and shows the corresponding MQL5 implementations.</p> <p><u>Understanding Time in MetaTrader 5</u></p> <p>All trading sessions pivot around time, and in MetaTrader time can mean several things: local computer time, UTC, or server time. For absolute accuracy, our EA always uses broker‑server time, retrieved with <i>TimeCurrent</i>(). Every calculation , from drawing windows to triggering alerts , refers to that value, so sessions remain correctly aligned on any broker or time zone.</p> <p> <pre class="code"><span class="comment">// Truncate to broker's midnight (00:00)</span>
<span class="keyword">datetime</span> Day0(<span class="keyword">datetime</span> t)
{
&nbsp;&nbsp; <span class="predefines">MqlDateTime</span> mt;
&nbsp;&nbsp; <span class="functions">TimeToStruct</span>(t, mt);
&nbsp;&nbsp; mt.hour = mt.min = mt.sec = <span class="number">0</span>;
&nbsp;&nbsp; <span class="keyword">return</span> <span class="functions">StructToTime</span>(mt);
}</pre>With the base day known, session start/finish times are built by converting human‑readable clock strings ( "07:00" , "16:00" ) into minutes: <pre class="code"><span class="keyword">int</span> ParseHM(<span class="keyword">string</span> s)
{
&nbsp;&nbsp; <span class="keyword">int</span> split = <span class="functions">StringFind</span>(s, <span class="string">":"</span>);
&nbsp;&nbsp; <span class="keyword">if</span>(split &lt; <span class="number">0</span>) <span class="keyword">return</span> <span class="number">0</span>;
&nbsp;&nbsp; <span class="keyword">return</span> <span class="number">60</span> * (<span class="keyword">int</span>)<span class="functions">StringToInteger</span>(<span class="functions">StringSubstr</span>(s, <span class="number">0</span>, split))
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;+&nbsp;&nbsp;&nbsp;&nbsp; (<span class="keyword">int</span>)<span class="functions">StringToInteger</span>(<span class="functions">StringSubstr</span>(s, split + <span class="number">1</span>));
}

<span class="keyword">datetime</span> MakeTime(<span class="keyword">datetime</span> base, <span class="keyword">string</span> tstr)
{
&nbsp;&nbsp; <span class="keyword">return</span> base + ParseHM(tstr) * <span class="number">60</span>;&nbsp;&nbsp;&nbsp;&nbsp;<span class="comment">// add minutes to 00:00</span>
}</pre> <div class="fquote"> Conceptually: Think of Day0() as the “anchor” for that trading day, and MakeTime() as a ruler measuring minutes from midnight. Whether your local computer shows GMT+2, EST, or CET doesn’t matter—everything remains in the broker’s timeline.<br/> </div> <p><u>Finding the Highs and Lows of Each Session</u></p> <p>Once time windows are defined, the EA must compute the open, high, low, and close for that range so it knows where to draw each rectangle.</p> <pre class="code"><span class="keyword">void</span> MakeSession(<span class="keyword">datetime</span> base, <span class="keyword">string</span> s1, <span class="keyword">string</span> s2,
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <span class="keyword">string</span> pref, <span class="keyword">string</span> name, <span class="keyword">color</span> col, <span class="keyword">int</span> order,
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <span class="keyword">double</span> &amp;outHi, <span class="keyword">double</span> &amp;outLo, <span class="keyword">double</span> &amp;outOp, <span class="keyword">double</span> &amp;outCl,
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <span class="keyword">bool</span> labelIt)
{
&nbsp;&nbsp; <span class="keyword">int</span> m1 = ParseHM(s1), m2 = ParseHM(s2);
&nbsp;&nbsp; <span class="keyword">datetime</span> t1 = base + m1 * <span class="number">60</span>, t2 = base + m2 * <span class="number">60</span>;
&nbsp;&nbsp; <span class="keyword">if</span>(t2 &lt;= t1) t2 += <span class="number">86400</span>;&nbsp;&nbsp; <span class="comment">// wrap around midnight if needed</span>

&nbsp;&nbsp; <span class="keyword">double</span> hi = -<span class="macro">DBL_MAX</span>, lo = <span class="macro">DBL_MAX</span>, opn = <span class="number">0</span>, cls = <span class="number">0</span>;
&nbsp;&nbsp; <span class="keyword">bool</span> haveOpen = <span class="macro">false</span>;

&nbsp;&nbsp; <span class="keyword">for</span>(<span class="keyword">int</span> i = <span class="number">0</span>; i &lt; <span class="functions">iBars</span>(<span class="predefines">_Symbol</span>, <span class="predefines">_Period</span>); i++)
&nbsp;&nbsp; {
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="keyword">datetime</span> bt = <span class="functions">iTime</span>(<span class="predefines">_Symbol</span>, <span class="predefines">_Period</span>, i);
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="keyword">if</span>(bt &lt; t1) <span class="keyword">break</span>;
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="keyword">if</span>(bt &gt;= t1 &amp;&amp; bt &lt;= t2)
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <span class="keyword">double</span> bh = <span class="functions">iHigh</span>(<span class="predefines">_Symbol</span>,<span class="predefines">_Period</span>,i);
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <span class="keyword">double</span> bl = <span class="functions">iLow</span> (<span class="predefines">_Symbol</span>,<span class="predefines">_Period</span>,i);
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <span class="keyword">if</span>(bh &gt; hi) hi = bh;
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <span class="keyword">if</span>(bl &lt; lo) lo = bl;
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <span class="keyword">if</span>(!haveOpen){ opn = <span class="functions">iOpen</span>(<span class="predefines">_Symbol</span>,<span class="predefines">_Period</span>,i); haveOpen = <span class="macro">true</span>; }
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; cls = <span class="functions">iClose</span>(<span class="predefines">_Symbol</span>,<span class="predefines">_Period</span>,i);
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;}
&nbsp;&nbsp; }

&nbsp;&nbsp; <span class="keyword">if</span>(hi &gt; <span class="number">0</span> &amp;&amp; lo != <span class="macro">DBL_MAX</span>)
&nbsp;&nbsp; {
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;DrawSession(pref, name, col, t1, t2, hi, lo, opn, cls, order, labelIt);
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;outHi = hi; outLo = lo; outOp = opn; outCl = cls;
&nbsp;&nbsp; }
}</pre> <p>How it works:&nbsp;&nbsp;</p> <ul> <li>The loop scans historical candles only within that session.</li> <li>The moment it moves earlier than the opening time, it stops—saving CPU cycles.</li> <li>The resulting values act as both drawing coordinates and reference points for future breakout alerts.</li> </ul> <p> <p><u>Painting the Sessions</u></p> <p>Visual clarity is achieved through the function <i>DrawSession</i>(). It creates a semi‑transparent rectangle spanning from the session’s start to end times, vertically bounded by the computed high and low. Each rectangle can optionally carry a small text label showing H/L/O/C for that session.</p> <pre class="code"><span class="keyword">void</span> DrawSession(<span class="keyword">string</span> pref, <span class="keyword">string</span> name, <span class="keyword">color</span> col,
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <span class="keyword">datetime</span> t1, <span class="keyword">datetime</span> t2, <span class="keyword">double</span> hi, <span class="keyword">double</span> lo,
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <span class="keyword">double</span> opn, <span class="keyword">double</span> cls, <span class="keyword">int</span> slot, <span class="keyword">bool</span> labelIt)
{
&nbsp;&nbsp; <span class="keyword">string</span> box = pref + <span class="functions">TimeToString</span>(t1, <span class="macro">TIME_DATE</span> | <span class="macro">TIME_MINUTES</span>);
&nbsp;&nbsp; SafeDelete(box);
&nbsp;&nbsp; <span class="functions">ObjectCreate</span>(<span class="number">0</span>, box, <span class="macro">OBJ_RECTANGLE</span>, <span class="number">0</span>, t1, hi, t2, lo);
&nbsp;&nbsp; <span class="functions">ObjectSetInteger</span>(<span class="number">0</span>, box, <span class="macro">OBJPROP_COLOR</span>, col);
&nbsp;&nbsp; <span class="functions">ObjectSetInteger</span>(<span class="number">0</span>, box, <span class="macro">OBJPROP_BACK</span>, <span class="macro">true</span>);
&nbsp;&nbsp; <span class="functions">ObjectSetInteger</span>(<span class="number">0</span>, box, <span class="macro">OBJPROP_WIDTH</span>, <span class="number">1</span>);

&nbsp;&nbsp; <span class="keyword">if</span>(labelIt)
&nbsp;&nbsp; {
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="keyword">string</span> lbl&nbsp;&nbsp;= box + <span class="string">"_LBL"</span>;
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="keyword">string</span> text = <span class="functions">StringFormat</span>(<span class="string">"%s&nbsp;&nbsp;H %.5f&nbsp;&nbsp;L %.5f&nbsp;&nbsp;O %.5f&nbsp;&nbsp;C %.5f"</span>,
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; name, hi, lo, opn, cls);
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;DrawLabelNoOverlap(lbl, hi, slot, text, col);
&nbsp;&nbsp; }
}</pre> <p>The helper <i>DrawLabelNoOverlap</i>() positions the text so that session labels are separated by a consistent distance:</p> <pre class="code"><span class="keyword">void</span> DrawLabelNoOverlap(<span class="keyword">string</span> id,<span class="keyword">double</span> baseY,<span class="keyword">int</span> slot,<span class="keyword">string</span> text,<span class="keyword">color</span> col)
{
&nbsp;&nbsp; <span class="keyword">datetime</span> anchor = <span class="functions">iTime</span>(<span class="predefines">_Symbol</span>,<span class="predefines">_Period</span>,<span class="number">0</span>);
&nbsp;&nbsp; <span class="keyword">datetime</span> offsetT = anchor - <span class="number">4</span>*<span class="functions">PeriodSeconds</span>(<span class="predefines">_Period</span>);
&nbsp;&nbsp; <span class="keyword">double</span> offsetY = (slot+<span class="number">1</span>) * <span class="predefines">_Point</span> * <span class="number">120</span>;&nbsp;&nbsp; <span class="comment">// uniform vertical spacing</span>

&nbsp;&nbsp; <span class="functions">ObjectCreate</span>(<span class="number">0</span>, id, <span class="macro">OBJ_TEXT</span>, <span class="number">0</span>, offsetT, baseY + offsetY);
&nbsp;&nbsp; <span class="functions">ObjectSetInteger</span>(<span class="number">0</span>, id, <span class="macro">OBJPROP_COLOR</span>, col);
&nbsp;&nbsp; <span class="functions">ObjectSetInteger</span>(<span class="number">0</span>, id, <span class="macro">OBJPROP_FONTSIZE</span>, <span class="number">8</span>);
&nbsp;&nbsp; <span class="functions">ObjectSetString</span> (<span class="number">0</span>, id, <span class="macro">OBJPROP_TEXT</span>, text);
}</pre> <p>The multiplier 120 ensures that the label for London lies the same distance below Tokyo as Tokyo does below Asia, preserving symmetry on any instrument’s price scale.</p> <p><u>Controlling the Lifecycle of Sessions</u></p> <p>Instead of redrawing each second (which could waste resources), the EA uses a smart update rhythm. A timer event fires once per second:&nbsp;</p> <pre class="code"><span class="keyword">void</span> <span class="functions">OnTimer</span>()
{
&nbsp;&nbsp; ScrollTicker();&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="comment">// move the text ticker</span>
&nbsp;&nbsp; CheckSessionAlerts();&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="comment">// detect openings &amp; closings</span>
&nbsp;&nbsp; CheckBreakouts();&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="comment">// look for price range breaks</span>

&nbsp;&nbsp; <span class="keyword">static</span> <span class="keyword">int</span> counter = <span class="number">0</span>;
&nbsp;&nbsp; <span class="keyword">if</span>(++counter &gt;= <span class="number">60</span>)&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="comment">// refresh once per minute</span>
&nbsp;&nbsp; {
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;DrawAll();
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;UpdatePanel();
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;counter = <span class="number">0</span>;
&nbsp;&nbsp; }
}</pre> <p>Every minute it deletes existing rectangles (via <i>DeletePrefix</i>()) and recreates them to stay in sync with current server time. Because everything is event‑driven, the EA uses CPU efficiently even with multiple charts open.</p> <p><u>Detecting Session Openings and Closings</u></p> <p>The function <i>CheckSessionAlerts</i>() compares the current broker time against each session’s open/close schedule. As soon as a boundary is crossed, it pushes a short message into the ticker and, optionally, triggers a sound alert.</p> <pre class="code"><span class="keyword">void</span> CheckSessionAlerts()
{
&nbsp;&nbsp; datetime now&nbsp;&nbsp;= TimeCurrent(), <span class="keyword">base</span> = Day0(now);
&nbsp;&nbsp; datetime asO&nbsp;&nbsp;= MakeTime(<span class="keyword">base</span>, AsiaStart),&nbsp;&nbsp; asC = MakeTime(<span class="keyword">base</span>, AsiaEnd);
&nbsp;&nbsp; datetime lnO&nbsp;&nbsp;= MakeTime(<span class="keyword">base</span>, LondonStart), lnC = MakeTime(<span class="keyword">base</span>, LondonEnd);
&nbsp;&nbsp; datetime nyO&nbsp;&nbsp;= MakeTime(<span class="keyword">base</span>, NewYorkStart),nyC = MakeTime(<span class="keyword">base</span>, NewYorkEnd);

&nbsp;&nbsp; <span class="keyword">if</span>(!openedAsia&nbsp;&nbsp;&amp;&amp; now &gt;= asO){ openedAsia&nbsp;&nbsp;= <span class="keyword">true</span>;&nbsp;&nbsp;UpdateTicker(<span class="string">"Asia session opened"</span>);&nbsp;&nbsp;}
&nbsp;&nbsp; <span class="keyword">if</span>(!closedAsia&nbsp;&nbsp;&amp;&amp; now &gt;= asC){ closedAsia&nbsp;&nbsp;= <span class="keyword">true</span>;&nbsp;&nbsp;UpdateTicker(<span class="string">"Asia session closed"</span>);&nbsp;&nbsp;}
&nbsp;&nbsp; <span class="keyword">if</span>(!openedLondon&amp;&amp; now &gt;= lnO){ openedLondon= <span class="keyword">true</span>;&nbsp;&nbsp;UpdateTicker(<span class="string">"London session opened"</span>);}
&nbsp;&nbsp; <span class="keyword">if</span>(!closedLondon&amp;&amp; now &gt;= lnC){ closedLondon= <span class="keyword">true</span>;&nbsp;&nbsp;UpdateTicker(<span class="string">"London session closed"</span>);}
&nbsp;&nbsp; <span class="keyword">if</span>(!openedNewYork&amp;&amp; now &gt;= nyO){openedNewYork=<span class="keyword">true</span>;&nbsp;&nbsp;UpdateTicker(<span class="string">"New York session opened"</span>);}
&nbsp;&nbsp; <span class="keyword">if</span>(!closedNewYork&amp;&amp; now &gt;= nyC){closedNewYork=<span class="keyword">true</span>;&nbsp;&nbsp;UpdateTicker(<span class="string">"New York session closed"</span>);}
}</pre> <p>At runtime, these notifications appear smoothly in the scrolling headline, giving traders real‑time awareness of global market transitions.</p> <p><u>Breakout Detection</u></p> <p>Beyond timing, traders often want to know when price escapes the previous session’s bounds. The EA’s breakout engine performs exactly that job.</p> <pre class="code"><span class="keyword">void</span> CheckBreakouts()
{
&nbsp;&nbsp; <span class="keyword">double</span> bid = <span class="functions">SymbolInfoDouble</span>(<span class="predefines">_Symbol</span>, <span class="macro">SYMBOL_BID</span>);

&nbsp;&nbsp; <span class="comment">// Example: New York breaking the prior London range</span>
&nbsp;&nbsp; <span class="keyword">if</span>(prevLondonHigh &gt; <span class="number">0</span>)
&nbsp;&nbsp; {
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="keyword">if</span>(!newYorkBreakHighDone &amp;&amp; bid &gt; prevLondonHigh)
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; newYorkBreakHighDone = <span class="macro">true</span>;
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; UpdateTicker(<span class="string">"New York breaks above prior London high"</span>);
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;}
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="keyword">if</span>(!newYorkBreakLowDone &amp;&amp; bid &lt; prevLondonLow)
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; newYorkBreakLowDone = <span class="macro">true</span>;
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; UpdateTicker(<span class="string">"New York breaks below prior London low"</span>);
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;}
&nbsp;&nbsp; }
}</pre> <p>Each flag (<i>BreakHighDone</i>,<i> BreakLowDone</i>) ensures that an alert is sent only once per direction, so messages remain clean and relevant even during sustained trends.</p> <div class="fquote"> <p>Seeing a sudden alert such as “London breaks above prior Tokyo high” lets traders immediately infer that market volatility is expanding—an excellent tool for timing breakout or reversal strategies.</p> </div> <p><u>Handling User Interaction</u></p> <p>The interface is interactive. Whenever a trader clicks a session button, MetaTrader sends a chart event captured by <i>OnChartEvent</i>(). The EA reacts by flipping a Boolean, redrawing affected rectangles, and updating the info panel.</p> <pre class="code"><span class="keyword">void</span> <span class="functions">OnChartEvent</span>(<span class="keyword">const</span> <span class="keyword">int</span> id,<span class="keyword">const</span> <span class="keyword">long</span> &amp;l,<span class="keyword">const</span> <span class="keyword">double</span> &amp;d,<span class="keyword">const</span> <span class="keyword">string</span> &amp;s)
{
&nbsp;&nbsp; <span class="keyword">if</span>(id == <span class="macro">CHARTEVENT_OBJECT_CLICK</span>)
&nbsp;&nbsp; {
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="keyword">if</span>(s == BTN_ASIA)&nbsp;&nbsp;&nbsp;&nbsp;{ showAsia&nbsp;&nbsp;&nbsp;&nbsp;= !showAsia;&nbsp;&nbsp;&nbsp;&nbsp;DrawAll(); UpdatePanel(); UpdateTicker(<span class="string">"Asia toggle changed"</span>); }
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="keyword">if</span>(s == BTN_TOKYO)&nbsp;&nbsp; { showTokyo&nbsp;&nbsp; = !showTokyo;&nbsp;&nbsp; DrawAll(); UpdatePanel(); UpdateTicker(<span class="string">"Tokyo toggle changed"</span>); }
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="keyword">if</span>(s == BTN_LONDON)&nbsp;&nbsp;{ showLondon&nbsp;&nbsp;= !showLondon;&nbsp;&nbsp;DrawAll(); UpdatePanel(); UpdateTicker(<span class="string">"London toggle changed"</span>); }
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="keyword">if</span>(s == BTN_NEWYORK) { showNewYork = !showNewYork; DrawAll(); UpdatePanel(); UpdateTicker(<span class="string">"New York toggle changed"</span>); }
&nbsp;&nbsp; }
}</pre> <p>This instantaneous response reinforces the concept of modularity—user interface actions are completely decoupled from analytical logic.</p> <p><u>Initialization and Cleanup</u></p> <p>Two simple routines frame the EA’s life cycle:&nbsp;</p> <pre class="code"><span class="keyword">int</span> <span class="functions">OnInit</span>()
{
&nbsp;&nbsp; CreateButton(BTN_ASIA,&nbsp;&nbsp; <span class="string">"Asia ON/OFF"</span>,&nbsp;&nbsp; <span class="number">10</span>, <span class="number">20</span>, AsiaColor);
&nbsp;&nbsp; CreateButton(BTN_TOKYO,&nbsp;&nbsp;<span class="string">"Tokyo ON/OFF"</span>,&nbsp;&nbsp;<span class="number">125</span>,<span class="number">20</span>, TokyoColor);
&nbsp;&nbsp; CreateButton(BTN_LONDON, <span class="string">"London ON/OFF"</span>, <span class="number">240</span>,<span class="number">20</span>, LondonColor);
&nbsp;&nbsp; CreateButton(BTN_NEWYORK,<span class="string">"New York ON/OFF"</span>,<span class="number">10</span>,<span class="number">45</span>, NewYorkColor);

&nbsp;&nbsp; CreatePanel();
&nbsp;&nbsp; CreateTicker();
&nbsp;&nbsp; DrawAll();
&nbsp;&nbsp; UpdatePanel();
&nbsp;&nbsp; UpdateTicker(Headline);

&nbsp;&nbsp; <span class="functions">EventSetTimer</span>(<span class="number">1</span>);&nbsp;&nbsp;&nbsp;&nbsp; <span class="comment">// start 1‑second timer</span>
&nbsp;&nbsp; <span class="keyword">return</span> <span class="macro">INIT_SUCCEEDED</span>;
}

<span class="keyword">void</span> <span class="functions">OnDeinit</span>(<span class="keyword">const</span> <span class="keyword">int</span> reason)
{
&nbsp;&nbsp; <span class="functions">EventKillTimer</span>();&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="comment">// stop the timer</span>
&nbsp;&nbsp; DeletePrefix(PREF_ASIA);
&nbsp;&nbsp; DeletePrefix(PREF_TOKYO);
&nbsp;&nbsp; DeletePrefix(PREF_LONDON);
&nbsp;&nbsp; DeletePrefix(PREF_NEWYORK);
}</pre> <p>On start‑up the EA builds its full interface; when removed, it cleans up completely so no orphaned rectangles remain.</p> <p><u>Logic Flow in Action</u></p> <p>To visualize the continuous process:</p> <p style="text-align:center;"> <img width="614" height="1081" src="https://c.mql5.com/2/177/flowchart_o28.png" loading="lazy" alt style="vertical-align:middle;"/></p> <p>Each stage operates independently yet communicates through shared global data—creating an always‑aware, self‑correcting tool.</p> <p><u>Compiling and Running the EA</u></p> <p>Once the entire script is copied into MetaEditor, save it inside</p> <pre class="code">MQL5\Experts\All Sessions Toggle EA.mq5</pre> <p>Then press Compile (F7) and attach the EA to any chart in MetaTrader 5. Once loaded, the chart should instantly transforms into an interactive dashboard: four toggle buttons appear in the upper‑left corner representing the Asia, Tokyo, London, and New York sessions; a sleek black information panel occupies the upper‑right corner displaying which sessions are currently ON or OFF; and a scrolling ticker headline runs along the bottom, reporting live status messages. Across the main chart area, color‑coded rectangles cover the previous and current trading days, each clearly labelled once with its own H, L, O, and C values for quick reference. If everything compiled correctly, the Experts tab at the bottom of the terminal will confirm successful initialization with the message “Sessions viewer running.”</p> <h3><br/></h3> <h3 id="testing_and_validation">Testing and Validation<br/></h3> <p>Before releasing or relying on any trading tool, thorough testing is essential. For this EA, testing confirms that all components—graphical, logical, and time‑based—behave consistently across different brokers, instruments, and time zones. This section outlines a systematic method to validate the EA’s performance and reliability.</p> <p style="text-align:center;"> <img width="735" height="686" src="https://c.mql5.com/2/176/session_ea.gif" loading="lazy" alt style="vertical-align:middle;"/></p> <p>The diagram above illustrates the All Sessions EA running on the Deriv Demo Account (EURUSD H1) chart. During this test, all four sessions—Asia, Tokyo, London, and New York—were enabled simultaneously. Each rectangle is displayed in its assigned color: Sky Blue for Asia, Light Green for Tokyo, Light Pink for London, and Gold for New York. In the upper‑left corner, the toggle buttons (“Asia ON/OFF,” “Tokyo ON/OFF,” etc.) confirm that the interactive interface loaded correctly within Deriv’s MetaTrader 5 environment. When clicked, each button instantly hides or redraws its corresponding session box, showing that the event‑handling and redraw functions are fully responsive under this broker’s infrastructure. The black information panel on the upper‑right accurately reports the live state of all sessions:&nbsp;&nbsp;</p> <ul> <li>ASIA : ON TOKYO : ON LONDON : ON NEW YORK : ON&nbsp;&nbsp;</li> </ul> <p> <p>This confirms that the UpdatePanel() routine synchronized the graphical panel with the Boolean flags controlling session visibility. Below it, the active ticker headline appears with the text “Sessions viewer running – toggle button”, verifying that the ticker object initialized properly and continues scrolling without overlap. Within the main price area, colored rectangles align perfectly with candle time boundaries on Deriv’s H1 chart, showing that the EA reads Deriv’s server time correctly through TimeCurrent(). Only one H‑L‑O‑C label appears per session, matching the design rule of single‑label display for clarity. The values beside each session title, such as “NEW YORK H 1.16224” and “TOKYO H 1.16158 L 1.158xx”—confirm that the EA collected OHLC data precisely from Deriv’s price feed. No flickering or performance lag was observed while switching between symbols (EURUSD, USDCHF, GBPUSD, and USDJPY), indicating that the timer refresh mechanism (1‑second interval) performs stably on Deriv’s platform. CPU and memory usage remained minimal throughout the session.&nbsp;&nbsp;</p> <p>Overall, this test validates that:</p> <ul> <li>The EA executes and renders perfectly in Deriv’s MetaTrader 5 environment.</li> <li>Time alignment and session lengths match global standards.</li> <li>Interactive elements—buttons, panel updates, and ticker—operate smoothly.</li> <li>The breakout‑alert system triggers accurately when price crosses the prior session’s extremes.</li> </ul> <p> <p>This Deriv‑based assessment confirms that the trading‑session logic, drawing routines, and alert mechanisms are stable and broker‑accurate under real‑time chart conditions.</p> <p>The Gif below is the alert popup</p> <p style="text-align:center;"> <img width="650" height="250" src="https://c.mql5.com/2/176/alert.gif" loading="lazy" alt style="vertical-align:middle;"/></p> <p><br/></p> <h3 id="conclusion">Conclusion</h3> <p>The creation of the All Sessions EA showcases how a simple concept—visually dividing the trading day into global market sessions—can mature into a refined analytical instrument. Originally intended as a helper for identifying session times, the project has grown into a complete, interactive system that synchronizes seamlessly with broker‑server time, reports live market transitions, and alerts traders to meaningful price breakouts as they happen. </p> <p>Through its blend of color‑coded rectangles, concise session labels, toggle buttons, and a scrolling ticker, the EA transforms the continuous rhythm of the foreign‑exchange market into an easy‑to‑read story. It allows traders to see at a glance which global region currently drives liquidity and how volatility shifts from Asia to Tokyo, through London, and on to New York. The modular, event‑driven structure ensures these visuals remain accurate and lightweight on any chart. </p> <p>For new traders, the EA acts as an educational guide that reveals how market energy flows throughout the trading day. For experienced users, it becomes a context‑building overlay—streamlining intraday planning, confirming breakout behavior, and simplifying session analysis.&nbsp;&nbsp; </p> <p>In this development cycle, the EA was thoroughly tested on Deriv’s trading environment, where it performed smoothly across different chart types and timeframes. The results confirmed full synchronization with Deriv’s server time, stable object rendering, accurate alert timing, and consistent H‑L‑O‑C label updates. Even under continuous operation, the EA maintained responsive performance and clean graphic behaviour, validating its efficiency in Deriv’s live and synthetic markets. Because the underlying architecture is modular, future customization remains simple. We can easily extend it to include features such as the Sydney session, push‑notification support, or historical session‑range statistics without rewriting the core logic.</p> <p>Ultimately, the EA is more than a colored overlay; it is a teaching and analytical companion that helps traders understand not just what prices are doing but when and why they move. By following the ebb and flow of each global session, traders using the Deriv platform—and any future supported brokers—gain a clear, time‑based perspective on volatility and liquidity. With precision, clarity, and simplicity at its heart, this EA turns the continuous 24‑hour market into a structured, visually intuitive experience—one session at a time.&nbsp;</p></p></p></p></p></p></p></p></p>
      </div>
<div id="cb_19944" class="attachBlock">
  <strong>Attached files</strong> |
  <div class="grouped-attachments-help">
    <a title="Download all attachments in the single ZIP archive" href="/en/articles/download/19944.zip">
      <i class="attach-icon attach-icon_zip"></i>Download ZIP
    </a>
  </div>
    <div class="attachItem">
      <a title="Download All_Sessions_EA.mq5" href="/en/articles/download/19944/All_Sessions_EA.mq5"><i class="attach-icon attach-icon_mq5"></i>All_Sessions_EA.mq5</a>
      <span class="attachSize">(32.86 KB)</span>
    </div>
</div>
    </div>

  <div class="copyright">
    <p><strong>Warning:</strong> All rights to these materials are reserved by MetaQuotes Ltd. Copying or reprinting of these materials in whole or in part is prohibited.</p>
      <p>This article was written by a user of the site and reflects their personal views. MetaQuotes Ltd is not responsible for the accuracy of the information presented, nor for any consequences resulting from the use of the solutions, strategies or recommendations described.</p>
  </div>



    <div class="article__author-with-articles">
      


<div class="article-footer__author">
  <div class="article-footer__author-avatar">
    <img id="avatar" src="https://c.mql5.com/avatar/2025/10/68fd3661-daee_big.png" title="Christian Benjamin" alt="Christian Benjamin" loading="lazy" width="164" height="164">
  </div>
  <div class="article-footer__author-content">
    <div class="article-footer__author-name">
      <a href="/en/users/lynnchris" title="Christian Benjamin">Christian Benjamin</a>
    </div>
    <div class="article-footer__author-info">
      <ul>
          <li>
            <i title="Works" class="icons-profile icons-profile_suitcase"></i>
Developer, Trader and Pastor
at            Out For Christ Ministries International
          </li>
          <li>
            <i title="Lives" class="icons-profile icons-profile_geo"></i>
            <a target="_blank" rel="noreferrer noopener nofollow" title="Lives" href="https://maps.google.com/?z=4&q=Zimbabwe">Zimbabwe</a>
          </li>
        <li>
          <i title="Rating" class="icons-profile icons-profile_statistics"></i>
          <a title="Rating" href="/en/users/lynnchris/achievements">20982</a>
        </li>
      </ul>
    </div>
    <div class="article-footer__author-contacts">
          <li title="Facebook"><a class="icons-networks icons-networks_fb-mini" target="_blank" rel="noreferrer noopener nofollow" href="https://www.facebook.com/christian benjamin"></a></li>

    </div>
    <div class="article-footer__author-bio">Excellence and integrity define my approach to every project. The same standard is maintained regardless of compensation structure, guided by the conviction that God’s reward surpasses what man can offer. This principle shapes every tool I develop.</div>
  </div>
</div>

      <div class="other-author-articles ui">
        <h4 class="other-author-articles__title">Other articles by this author</h4>
        <ul class="other-author-articles__list">
          <li><a href="/en/articles/23100" data-fz-event="MQL5+Article+From+Author+Article">Engineering Trading Discipline into Code (Part 8): Building a Setup Confirmation and Trade Authorization Layer in MQL5</a></li>
          <li><a href="/en/articles/23015" data-fz-event="MQL5+Article+From+Author+Article">Price Action Analysis Toolkit Development (Part 74): Building an MQL5 Expert Advisor from Indicator Buffers</a></li>
          <li><a href="/en/articles/22993" data-fz-event="MQL5+Article+From+Author+Article">Price Action Analysis Toolkit Development (Part 73): Building a Weekend Gap Trading Signal System in MQL5</a></li>
          <li><a href="/en/articles/22884" data-fz-event="MQL5+Article+From+Author+Article">Price Action Analysis Toolkit Development (Part 72): Building a Gap Fill Indicator in MQL5</a></li>
          <li><a href="/en/articles/22833" data-fz-event="MQL5+Article+From+Author+Article">Engineering Trading Discipline into Code (Part 7): Automating Equity Protection Through Governance Logic</a></li>
          <li><a href="/en/articles/22796" data-fz-event="MQL5+Article+From+Author+Article">Price Action Analysis Toolkit Development (Part 71): Weekend Gap Structure Mapping in MQL5</a></li>
          <li><a href="/en/articles/22607" data-fz-event="MQL5+Article+From+Author+Article">Price Action Analysis Toolkit Development (Part 70): Turning Flag Pattern Signals into Automated Trade Execution</a></li>
        </ul>
      </div>
    </div>


  <div class="article__last-comments" id="articleAdditional">
    

<div class="comments-preview">
    <div class="title">
      <span></span><b>
 <a href="/en/forum/498771">Go to discussion</a>
      </b>
    </div>
    <div>
        
    </div>
</div>

  </div>


    <div class="articles-bottom-list" id="articleAdditional">
        <div class="articles-bottom-list__row">
          <div class="articles-bottom-list__column">
              <div class="articles-bottom-list__item">
                <img alt="Building a Smart Trade Manager in MQL5: Automate Break-Even, Trailing Stop, and Partial Close" src="https://c.mql5.com/2/177/19911-building-a-smart-trade-manager-logo.png" loading="lazy" width="60" height="60" class="articles-bottom-list__avatar">
                <a href="/en/articles/19911" data-fz-event="MQL5+Article+Next+Article" class="articles-bottom-list__title">Building a Smart Trade Manager in MQL5: Automate Break-Even, Trailing Stop, and Partial Close</a>
                <div class="articles-bottom-list__desc">Learn how to build a Smart Trade Manager Expert Advisor in MQL5 that automates trade management with break-even, trailing stop, and partial close features. A practical, step-by-step guide for traders who want to save time and improve consistency through automation.</div>
              </div>
          </div>
          <div class="articles-bottom-list__column">
              <div class="articles-bottom-list__item">
                <img alt="Statistical Arbitrage Through Cointegrated Stocks (Part 6): Scoring System" src="https://c.mql5.com/2/177/20026-statistical-arbitrage-through-logo__1.png" loading="lazy" width="60" height="60" class="articles-bottom-list__avatar">
                <a href="/en/articles/20026" data-fz-event="MQL5+Article+Next+Article" class="articles-bottom-list__title">Statistical Arbitrage Through Cointegrated Stocks (Part 6): Scoring System</a>
                <div class="articles-bottom-list__desc">In this article, we propose a scoring system for mean-reversion strategies based on statistical arbitrage of cointegrated stocks. The article suggests criteria that go from liquidity and transaction costs to the number of cointegration ranks and time to mean-reversion, while taking into account the strategic criteria of data frequency (timeframe) and the lookback period for cointegration tests, which are evaluated before the score ranking properly. The files required for the reproduction of the backtest are provided, and their results are commented on as well.</div>
              </div>
          </div>
        </div>
        <div class="articles-bottom-list__row">
          <div class="articles-bottom-list__column">
              <div class="articles-bottom-list__item">
                <img alt="Automating Trading Strategies in MQL5 (Part 37): Regular RSI Divergence Convergence with Visual Indicators" src="https://c.mql5.com/2/176/20031-automating-trading-strategies-logo.png" loading="lazy" width="60" height="60" class="articles-bottom-list__avatar">
                <a href="/en/articles/20031" data-fz-event="MQL5+Article+Next+Article" class="articles-bottom-list__title">Automating Trading Strategies in MQL5 (Part 37): Regular RSI Divergence Convergence with Visual Indicators</a>
                <div class="articles-bottom-list__desc">In this article, we build an MQL5 EA that detects regular RSI divergences using swing points with strength, bar limits, and tolerance checks. It executes trades on bullish or bearish signals with fixed lots, SL/TP in pips, and optional trailing stops. Visuals include colored lines on charts and labeled swings for better strategy insights.</div>
              </div>
          </div>
          <div class="articles-bottom-list__column">
              <div class="articles-bottom-list__item">
                <img alt="Introduction to MQL5 (Part 26): Building an EA Using Support and Resistance Zones" src="https://c.mql5.com/2/177/20021-introduction-to-mql5-part-26-logo.png" loading="lazy" width="60" height="60" class="articles-bottom-list__avatar">
                <a href="/en/articles/20021" data-fz-event="MQL5+Article+Next+Article" class="articles-bottom-list__title">Introduction to MQL5 (Part 26): Building an EA Using Support and Resistance Zones</a>
                <div class="articles-bottom-list__desc">This article teaches you how to build an MQL5 Expert Advisor that automatically detects support and resistance zones and executes trades based on them. You’ll learn how to program your EA to identify these key market levels, monitor price reactions, and make trading decisions without manual intervention.</div>
              </div>
          </div>
        </div>
    </div>

<div class="clear-fix"></div>

<div id='wdausxxqrpvhekbwjrjlhqjghyhesrqqau' class="rzu1nwfal9w2b8ncf rzu1nwfal9w2b8ncf_articles-view g7h2ap3u5"></div>
    

<div class="hidden" id="popupRegisterLogin">
  <div class="register-login-popup">
    <div class="register-login-popup__header">
      <img src="https://c.mql5.com/i/registerlandings/logo-2.png" srcset="https://c.mql5.com/i/registerlandings/logo-2_2x.png 2x" alt="MQL5 - Language of trade strategies built-in the MetaTrader 5 client terminal" loading="lazy" width="74" height="24" />
    </div>
    <div class="register-login-popup__content">
      <div class="register-login-popup__desc">
        <div class="register-login-popup__title">You are missing trading opportunities:</div>
        <ul>
<li>Free trading apps</li>
<li>Over 8,000 signals for copying</li>
<li>Economic news for exploring financial markets</li>
</ul>
      </div>
      <div class="register-login-popup__forms ui">
        <div class="register-login-popup__tabs" id="registerLoginPopupTabs">
          <span data-id="register" id="registerLoginPopupTab_register" class="register-login-popup__tab register-login-popup__tab_active">Registration</span>
          <span data-id="login" id="registerLoginPopupTab_login" class="register-login-popup__tab">Log in</span>
        </div>
        <div id="registerLoginPopupTabContent_register">
          <div class="ui auth-form__content">
    
  <script type='text/javascript'>/*<![CDATA[*/ if (!window.V) var V = []; /*]]>*/</script>
<script type='text/javascript'>/*<![CDATA[*/ if(! window.V) var V=[]; /*]]>*/</script>
<form method="POST" action="/en/auth_register_short" id="PopupRegisterquickRegisterForm" onsubmit="PopupRegisterquickRegistration.OnSubmit(this,&#39;en&#39;);if(Validate(this)) Ajax.form(this,{onready:PopupRegisterquickRegistration.OnSuccessPopup,onerror:PopupRegisterquickRegistration.OnError,onbeginrequest:PopupRegisterquickRegistration.DisableInputs,onendrequest:PopupRegisterquickRegistration.EnableInputs});return(false);" enctype = "multipart/form-data"><input type="hidden" name="__signature" value="c4d1e4eafb4161edfbbf1165646e74d5"/>
    <div class="auth-form__inputs">
      <input type="hidden" value="0" name="IsValidate" id="PopupRegisterIsValidate" />

      <!--[if lt IE 10]><div class="note">Login:</div><![endif]-->
      <div class="auth-form__box-input">
        <input type="text" id="PopupRegisterusername" name="username" class="input" maxlength="32" onchange="if(window.PopupRegisterquickRegistration){PopupRegisterquickRegistration.CheckUserName();}" onkeyup="if(window.PopupRegisterquickRegistration){PopupRegisterquickRegistration.ValidateUserName(this, 'Enter a valid login');}" placeholder="Login" title="May contain Latin letters, digits, dots, dashes,underscore characters. Cannot start or end with a dot. The allowed length is 3 to 32 characters." onfocus="if(window.PopupRegisterquickRegistration){PopupRegisterquickRegistration.OnFocus(this,'');}" onblur="if(window.PopupRegisterquickRegistration){PopupRegisterquickRegistration.OnBlur(this);}">
        <script type='text/javascript' id='validate_PopupRegisterusername'>/*<![CDATA[*/ mqGlobal.AddOnReady(function() {V.push(['PopupRegisterusername',10,'You may use Latin characters, numbers, underscores and periods.',validate_username]);}); /*]]>*/</script>

        <label class="label" for="PopupRegisterusername">latin characters without spaces</label>
      </div>
      <!--[if lt IE 10]><div class="note">Your email:</div><![endif]-->
      <div class="auth-form__box-input">
        <input class="input" type="email" id="PopupRegisteremail" name="email" placeholder="Your email" title="Please enter the email (it may not exceed 256 characters). For example: john@example.com" onchange="if(window.PopupRegisterquickRegistration){PopupRegisterquickRegistration.OnChange(this);}" onfocus="if(window.PopupRegisterquickRegistration){PopupRegisterquickRegistration.OnFocus(this,'');}" onblur="if(window.PopupRegisterquickRegistration){PopupRegisterquickRegistration.OnBlur(this);}">
        <script type='text/javascript' id='validate_PopupRegisteremail'>/*<![CDATA[*/ mqGlobal.AddOnReady(function() {V.push(['PopupRegisteremail',10,'Enter a valid email address',validate_email]);}); /*]]>*/</script>

        <label class="label" for="PopupRegisteremail">a password will be sent to this email</label>
      </div>
      <input name="PrefixId" type="hidden" value="Popup&#x2B;Register" />
    </div>
    <span id="PopupRegisterquickRegisterSubmit">
      <input type="submit" value="Register" id="PopupRegisterquickRegisterButton"  title="Sign up and receive an email with your password" class="button button_yellow"  />
    </span>
    <span id="PopupRegisterquickRegisterErrorMessage" class="quick-register-error-message field-validation-error" style="text-align: center; margin-top: 16px; display: none;">
      An error occurred
    </span>
</form>
    
</div>
<div class="auth-social">
  <ul class="auth-social-list" id="socialList">
    <li><a onclick="window.fpush({name: 'MQL5+Popup+Register+Google', unit: 'section', value: 'Articles'}); " href="https://www.mql5.com/en/auth_oauth2?provider=Google&amp;amp;return=popup&amp;amp;reg=1" class="auth-soc-button qa-google-button auth-soc-button_google" rel="nofollow">Log in With Google</a></li>
  </ul>
</div>
<div class="auth-block-agree">
  <p>
    You agree to <a target="_blank" href="/en/about/privacy">website policy</a> and <a target="_blank" href="/en/about/terms">terms of use</a>
  </p>
</div>


        </div>
        <div id="registerLoginPopupTabContent_login" class="hidden">
            <div class="auth-form__text">
    If you do not have an account, please <a href="https://www.mql5.com/en/auth_register" rel="nofollow" style="vertical-align: top">register</a>
  </div>
<div class="ui auth-form__content auth-form__content_login" id="loginFormWrapper">
    
  <div id="needCookies" class="need-cookies hidden">
    <div class="danger-box">
      <p>Allow the use of cookies to log in to the MQL5.com website.</p>
<p>Please enable the necessary setting in your browser, otherwise you will not be able to log in.</p>
    </div>
  </div>
<script type='text/javascript'>/*<![CDATA[*/ if(! window.V) var V=[]; /*]]>*/</script>
<form method="POST" action="/en/auth_login" id="loginForm" onsubmit="if(window.quickLogin){return window.quickLogin.onSubmit(this);}var result = Validate(this); if(result) { preventDoubleSubmit(this); } return result;"><input id="RedirectAfterLoginUrl" name="RedirectAfterLoginUrl" type="hidden" value="" /><input id="RegistrationUrl" name="RegistrationUrl" type="hidden" value="" /><input data-val="true" data-val-required="The ShowOpenId field is required." id="ShowOpenId" name="ShowOpenId" type="hidden" value="True" /><input id="TrackingSection" name="TrackingSection" type="hidden" value="Articles" />    <input name="ViewType" type="hidden" value="5" />
      <input name="PrefixId" type="hidden" value="Popup&#x2B;Login" />
    <!--[if lt IE 10]><div class="note">Your login:</div><![endif]-->
    <div class="auth-form__box-input">
      <input class="input qa-login" id="Login" name="Login" onchange="if(window.quickLogin){window.quickLogin.onChange(this);}" placeholder="Login" title="Your login" type="text" value="" />
      <script type='text/javascript' id='validate_Login'>/*<![CDATA[*/ mqGlobal.AddOnReady(function() {V.push(['Login',1,'Enter login specified when signing up']);});mqGlobal.AddOnReady(function() {V.push(['Login',10,'Email cannot be used. Enter your login please',validateLogin]);}); /*]]>*/</script>
    </div>
    <!--[if lt IE 10]><div class="note">Password:</div><![endif]-->
    <div class="auth-form__box-input">
      <div class="input-with-show">
        <input autocomplete="off" class="input qa-password" id="Password" name="Password" onchange="if(window.quickLogin){window.quickLogin.onChange(this);}" placeholder="Password" title="Enter the password please" type="password" />
        <span class="input-with-show__icon" title="Show password" onclick="if(window.quickLogin){window.quickLogin.showPass(this, 'Show password', 'Hide password');}"></span>
      </div>
      <script type='text/javascript' id='validate_Password'>/*<![CDATA[*/ mqGlobal.AddOnReady(function() {V.push(['Password',1,'Please enter the password']);}); /*]]>*/</script>
    </div>
    <script type="text/javascript">
    function validateLogin(input) {
      return !/^\w+([-+.'']{1,2}\w+)* @\w+([-.]\w+)*\.\w+([-.]\w+)*$/i.test(input.value);
    }
    </script>
    <div class="forgot" id="loginForgotBlock"><a id="loginForgotLink" href="https://www.mql5.com/en/auth_forgotten?return=popup">Forgot your login/password?</a></div>
    <input type="submit" class="button button_yellow qa-submit" id="loginSubmit" value="Log in" title="Enter">
</form></div>

  <div class="auth-social" id="authSocialBlock">
    <ul class="auth-social-list" id="socialList">
      <li><a onclick="window.fpush({name: 'MQL5+Popup+Login+Google', unit: 'section', value: 'Articles'}); " href="https://www.mql5.com/en/auth_oauth2?provider=Google&amp;amp;return=popup" class="auth-soc-button qa-google-button auth-soc-button_google" rel="nofollow">Log in With Google</a></li>
    </ul>
  </div>

        </div>
      </div>
    </div>
  </div>
</div>
<script id="popupSection" type="application/json">{"section": "Articles"}</script>
<script id="popupTranslate" data-type="translate" type="application/json">
{
  "popup":
  {
  "EmailTitle" : "The password has been sent to {0}",
  "EmailDescription" : "Log in using the obtained password and the login specified during the registration",
  "SubmitButtonText" : "Activate account",
  "RegistrationTip" : "If you have not received the password email, check the spam folder or &lt;a href={0}&gt;repeat the registration&lt;/a&gt;"
  }
}
</script>

    

    


    </article>
  </div>



<div aria-hidden="true" class="footer  desktop" id="footer">
  <ul class="links  links_desktop">
      <li id="navFooterCommunity">
        <nav>
          <ul>
            <li><a href="https://web.metatrader.app/terminal?mode=demo&amp;lang=en" target="_blank" rel="nofollow noopener" data-fz-event="MQL5+Footer+Trading">Online trading / WebTerminal</a></li>
            <li><a href="/en/code" data-fz-event="MQL5+Footer+CodeBase">Free technical indicators and robots</a></li>
            <li><a href="/en/articles" data-fz-event="MQL5+Footer+Articles">Articles about programming and trading</a></li>
            <li><a href="/en/job" data-fz-event="MQL5+Footer+Job">Order trading robots on the Freelance</a></li>
            <li><a href="/en/market" data-fz-event="MQL5+Footer+Market">Market of Expert Advisors and applications&#x9;</a></li>
            <li><a href="/en/signals" data-fz-event="MQL5+Footer+Signals">Follow forex signals</a></li>
            <li><a href="/en/vps" data-fz-event="MQL5+Footer+VPS">Low latency forex VPS</a></li>
            <li><a href="/en/forum" data-fz-event="MQL5+Footer+Forum">Traders forum</a></li>
            <li><a href="/en/blogs" data-fz-event="MQL5+Footer+Blogs">Trading blogs</a></li>
            <li><a rel="nofollow" href="/en/charts" data-fz-event="MQL5+Footer+Charts">Charts</a></li>
            <li><a href="/en/widgets" data-fz-event="MQL5+Footer+Widgets">Free widgets</a></li>
          </ul>
        </nav>
      </li>
      <li id="navFooterMt5">
        <nav>
          <ul>
            <li><a rel="nofollow noopener" href="https://www.metatrader5.com" data-fz-event="MQL5+Footer+MetaTrader+5"><span class="nobr">MetaTrader 5</span> Trading Platform</a></li>
            <li><a rel="nofollow noopener" href="https://www.metatrader5.com/en/releasenotes" data-fz-event="MQL5+Footer+MetaTrader+5"><span class="nobr">MetaTrader 5</span> latest updates</a></li>
            <li><a rel="nofollow noopener" href="https://www.metatrader5.com/en/news" data-fz-event="MQL5+Footer+MetaTrader+5">News, implementations and technology</a></li>
            <li><a rel="nofollow noopener" href="https://www.metatrader5.com/en/terminal/help" data-fz-event="MQL5+Footer+MetaTrader+5"><span class="nobr">MetaTrader 5</span> User Manual</a></li>
            <li><a href="/en/docs" data-fz-event="MQL5+Footer+Docs">MQL5 language of trading strategies</a></li>
            <li><a rel="nofollow noopener" href="https://cloud.mql5.com" data-fz-event="MQL5+Footer+Cloud">MQL5 Cloud Network</a></li>
            <li><a rel="noopener" href="https://forge.mql5.io/?lang=en" data-fz-event="MQL5+Footer+Forge" target="_blank">MQL5 Algo Forge</a></li>
              <li><a rel="nofollow noopener" href="https://download.terminal.free/cdn/web/metaquotes.ltd/mt5/mt5setup.exe?utm_source=www.mql5.com&amp;utm_campaign=download" data-fz-event="MetaTrader+5+Desktop+Download+Footer">Download <span class="nobr">MetaTrader 5</span></a></li>
              <li><a rel="nofollow noopener" href="https://www.metatrader5.com/en/terminal/help/start_advanced/installation" data-fz-event="MQL5+Footer+MetaTrader+5">Install Platform</a></li>
              <li><a rel="nofollow noopener" href="https://www.metatrader5.com/en/terminal/help/start_advanced/deinstallation" data-fz-event="MQL5+Footer+MetaTrader+5">Uninstall Platform</a></li>
          </ul>
        </nav>

      </li>
    <li id="navFooterWebsite">
        <nav>
          <ul>
            <li><a rel="nofollow" href="/en/about" data-fz-event="MQL5+Footer+About">About</a></li>
              <li><a href="/en/wall" data-fz-event="MQL5+Footer+Wall">Timeline</a></li>
            <li><a rel="nofollow" href="/en/about/terms" data-fz-event="MQL5+Footer+About">Terms and Conditions</a></li>
            <li><a rel="nofollow" href="/en/about/autopayments" data-fz-event="MQL5+Footer+About">Recurring Payment Agreement</a></li>
            <li><a rel="nofollow" href="/en/about/agencyagreement" data-fz-event="MQL5+Footer+About">Agency Agreement – Offer</a></li>
            <li><a rel="nofollow" href="/en/about/privacy" data-fz-event="MQL5+Footer+About">Privacy and Data Protection Policy</a></li>
            <li><a rel="nofollow" href="/en/about/cookies" data-fz-event="MQL5+Footer+About">Cookies Policy</a></li>
            <li>
                <a rel="nofollow" href="/en/contact" data-fz-event="MQL5+Footer+Contacts">Contacts and requests</a>
            </li>
          </ul>
        </nav>
    </li>

      <li>
        <div class="footer__products">
          <div class="footer__product">
            <a target="_blank" rel="nofollow noopener" href="https://www.metatrader5.com" class="footer__product-name">MetaTrader 5</a>
            <div class="footer__product-links">
            <a rel="nofollow noopener" href="https://download.terminal.free/cdn/web/metaquotes.ltd/mt5/mt5setup.exe?utm_source=www.mql5.com&amp;utm_campaign=download" class="icon windows" data-fz-event="MetaTrader+5+Desktop+Download+Footer"><div class="footer__product-link-hint footer__product-link-hint-short">Download MetaTrader 5 for Windows</div></a>
            <a rel="nofollow noopener" href="https://download.terminal.free/cdn/web/metaquotes.ltd/mt5/MetaTrader5.pkg.zip?utm_source=www.mql5.com&amp;utm_campaign=download" class="icon macos" data-fz-event="MetaTrader+5+Desktop+Download+Footer"><div class="footer__product-link-hint footer__product-link-hint-short">Download MetaTrader 5 for MacOS</div></a>
            <a rel="nofollow noopener" href="https://www.mql5.com/en/articles/625?utm_source=www.mql5.com&amp;utm_campaign=download" class="icon linux" data-fz-event="MetaTrader+5+Desktop+Download+Footer"><div class="footer__product-link-hint footer__product-link-hint-short">Download MetaTrader 5 for Linux</div></a>
            <a rel="nofollow noopener" href="https://web.metatrader.app/terminal?mode=demo&amp;lang=en" class="icon web"><div  class="footer__product-link-hint footer__product-link-hint-short">Open MetaTrader 5 WebTerminal</div></a>
            <a rel="nofollow noopener" href="https://download.terminal.free/cdn/mobile/mt5/ios?utm_source=www.mql5.com&amp;utm_campaign=install.metaquotes&amp;hl=en" class="icon ios" data-fz-event="MetaTrader+5+iOS+Download+Footer"><div class="footer__product-link-hint" style="background-image: url(https://c.mql5.com/qr/jhZn8Ed1I1d.png)">Scan to install from App Store</div></a>
            <a rel="nofollow noopener" href="https://download.terminal.free/cdn/mobile/mt5/android?utm_source=www.mql5.com&amp;utm_campaign=install.metaquotes&amp;hl=en" class="icon android" data-fz-event="MetaTrader+5+Android+Download+Footer"><div class="footer__product-link-hint" style="background-image: url(https://c.mql5.com/qr/kiF2Io6W-9d.png)">Scan to install from Google Play</div></a>
            <a rel="nofollow noopener" href="https://download.terminal.free/cdn/mobile/mt5/android/app-gallery?utm_source=www.mql5.com&amp;utm_campaign=install.metaquotes" class="icon huawei" data-fz-event="MetaTrader+5+Android+Download+Footer"><div class="footer__product-link-hint" style="background-image: url(https://c.mql5.com/qr/ZRt&#x2B;zI1l&#x2B;8O.png)">Scan to install from Huawei AppGallery</div></a>
            <a rel="nofollow noopener" href="https://download.terminal.free/cdn/web/metaquotes.software.corp/mt5/metatrader5.apk?utm_source=www.mql5.com&amp;utm_campaign=install.metaquotes" class="icon ark" data-fz-event="MetaTrader+5+Android+Download+Footer"><div class="footer__product-link-hint" style="background-image: url(https://c.mql5.com/qr/L0Q9oag&#x2B;3eE.png)">Scan to get Android APK file</div></a>
            </div>
          </div>
          <div>
            <div class="footer__product">
              <a target="_blank" rel="nofollow noopener" href="https://www.metatrader5.com/en/news/2270" class="footer__product-name">MQL5 Channels</a>
              <div class="footer__product-links">
              <a rel="nofollow noopener" href="https://download.terminal.free/cdn/mobile/mql5.channels/ios?utm_source=www.mql5.com&amp;utm_campaign=download&amp;hl=en" class="icon ios" data-fz-event="MQL5+Channels+iOS+Download+Footer"><div class="footer__product-link-hint" style="background-image: url(https://c.mql5.com/qr/bZVfOJnYpcO.png)">Scan to install from App Store</div></a>
              <a rel="nofollow noopener" href="https://download.terminal.free/cdn/mobile/mql5.channels/android?utm_source=www.mql5.com&amp;utm_campaign=download&amp;hl=en" class="icon android" data-fz-event="MQL5+Channels+Android+Download+Footer"><div class="footer__product-link-hint" style="background-image: url(https://c.mql5.com/qr/32MJFgw7BVs.png)">Scan to install from Google Play</div></a>
              <a rel="nofollow noopener" href="https://download.terminal.free/cdn/mobile/mql5.channels/android/app-gallery?utm_source=www.mql5.com&amp;utm_campaign=download" class="icon huawei" data-fz-event="MQL5+Channels+Android+Download+Footer"><div class="footer__product-link-hint" style="background-image: url(https://c.mql5.com/qr/Su&#x2B;fe4n374e.png)">Scan to install from Huawei AppGallery</div></a>
              <a rel="nofollow noopener" href="https://download.terminal.free/cdn/web/metaquotes.software.corp/mql5channels/mql5channels.apk?utm_source=www.mql5.com&amp;utm_campaign=download" class="icon ark" data-fz-event="MQL5+Channels+Android+Download+Footer"><div class="footer__product-link-hint" style="background-image: url(https://c.mql5.com/qr/G6Mg4NfCPzO.png)">Scan to get Android APK file</div></a>
              </div>
            </div>
            <div class="footer__product">
              <a target="_blank" rel="nofollow noopener" href="https://www.tradays.com/en/download?utm_source=www.mql5.com&amp;utm_campaign=download" data-fz-event="MQL5+Footer+Download+Tradays" class="footer__product-name">Economic Calendar</a>
              <div class="footer__product-links">
              <a rel="nofollow noopener" href="https://download.terminal.free/cdn/mobile/tradays/ios?utm_source=www.mql5.com&amp;utm_campaign=download&amp;hl=en" class="icon ios" data-fz-event="Tradays+iOS+Download+Footer"><div class="footer__product-link-hint" style="background-image: url(https://c.mql5.com/qr/CpD&#x2B;mhIw-1E.png)">Scan to install from App Store</div></a>
              <a rel="nofollow noopener" href="https://download.terminal.free/cdn/mobile/tradays/android?utm_source=www.mql5.com&amp;utm_campaign=download&amp;hl=en" class="icon android" data-fz-event="Tradays+Android+Download+Footer"><div class="footer__product-link-hint" style="background-image: url(https://c.mql5.com/qr/Bgyx8UcmYap.png)">Scan to install from Google Play</div></a>
              <a rel="nofollow noopener" href="https://download.terminal.free/cdn/mobile/tradays/android/app-gallery?utm_source=www.mql5.com&amp;utm_campaign=download" class="icon huawei" data-fz-event="Tradays+Android+Download+Footer"><div class="footer__product-link-hint" style="background-image: url(https://c.mql5.com/qr/CrS7bbDAdAO.png)">Scan to install from Huawei AppGallery</div></a>
              <a rel="nofollow noopener" href="https://download.terminal.free/cdn/web/metaquotes.software.corp/tradays/tradays.apk?utm_source=www.mql5.com&amp;utm_campaign=download" class="icon ark" data-fz-event="Tradays+Android+Download+Footer"><div class="footer__product-link-hint" style="background-image: url(https://c.mql5.com/qr/VZi8YPIb2op.png)">Scan to get Android APK file</div></a>
              </div>
            </div>
          </div>
        </div>

        <div class="footer__networks">
          <a href="https://www.facebook.com/mql5.community/" target="_blank" rel="nofollow" title="Facebook"><i class="icons-networks icons-networks_fb"></i></a>
          <a href="https://t.me/mql5dev" target="_blank" rel="nofollow" title="Telegram"><i class="icons-networks icons-networks_tg"></i></a>
          <a href="https://x.com/mql5com" target="_blank" rel="nofollow" title="X (Twitter)"><i class="icons-networks icons-networks_tw"></i></a>
          <a href="https://www.youtube.com/@MetaQuotesOfficial" target="_blank" rel="nofollow" title="YouTube"><i class="icons-networks icons-networks_yt"></i></a>
          <a href="https://www.linkedin.com/company/mql5" target="_blank" rel="nofollow" title="LinkedIn"><i class="icons-networks icons-networks_linkedin"></i></a>
          <span>Subscribe to algotrading news</span>
        </div>
  
        <div class="footer__other">
          <div class="footer__not-a-broker">Not a broker, no real trading accounts</div>
          <div class="copyright">35 Dodekanisou str, Germasogeia, 4043,&nbsp;Limassol,&nbsp;Cyprus</div>
          <div class="copyright">Copyright 2000-2026, <span class="nobr">MetaQuotes Ltd</span></div>
        </div>
      </li>
  </ul>
</div>



<div class="shadow-layer" id="layer"></div>
    


  

  <div class="b-fixed-mt" id="bFixedMt" style="display: none;">
    
  </div>


<script type='text/javascript'>
		(function (a, e, f, g, b, c, d) { a[b] || (a.FintezaCoreObject = b, a[b] = a[b] || function () { (a[b].q = a[b].q || []).push(arguments) }, a[b].l = 1 * new Date, c = e.createElement(f), d = e.getElementsByTagName(f)[0], c.async = !0, c.defer = !0, c.src = g, d && d.parentNode && d.parentNode.insertBefore(c, d)) })
      (window, document, "script", "/ff/core.js", "fz");
		window.fz("register", "website", {
      id: "sqjxkxkswybhifrohpyooonwgbvsfzmayq",
			trackLinks: true
		});
        mqGlobal.AddOnReady(function () { Mql5Cookie.init('mql5.com', '5045569623691570018'); });
mqGlobal.AddOnReady(function(){if(!window.Pocket){window.Pocket=new PocketManager();}});mqGlobal.AddOnReady(function(){if(!window.translateManager){window.translateManager=new Translate(undefined,'Error: failed to translate. Please try again later.');}if(document.querySelectorAll){var translateElements=document.querySelectorAll(".translateMenu");if(translateElements){var i=0,count=translateElements.length;for(i;i<count;i++){(function(i){var contentid=dataset(translateElements[i],"contentid"),sourcelang=dataset(translateElements[i],"sourcelang"),targetlang=dataset(translateElements[i],"targetlang"),moduleid=parseInt(dataset(translateElements[i],"moduleid")),typeid=parseInt(dataset(translateElements[i],"typeid")),entityid=parseInt(dataset(translateElements[i],"entityid"));Core.AddHandler(translateElements[i],"mouseover",function(){return translateManager.SetMenu(this,contentid,sourcelang,targetlang,moduleid,typeid,entityid);});})(i);}}}});window.fz("show","wdausxxqrpvhekbwjrjlhqjghyhesrqqau");window.mqGlobal.AddOnLoad(function(){window.fpush('MQL5+Article+Open');Articles.CheckOnScrollDown();});mqGlobal.AddOnReady(function(){window.PopupRegisterquickRegistration=new QuickRegistration('PopupRegister','Popup+Register','Articles');});function validate_username(input){var reg=/^([a-z0-9]){1}([\-._a-z0-9]){1,30}([\-_a-z0-9]){1}$/i,value=input.value,result=true;if(reg.test(value)){result=true;}else{result=false;window.fpush({name:'MQL5+Popup+Register+Invalid+Login',unit:'section',value:'Articles'});}return result;}function validate_email(input){var reg=/^\w+([-+.'']{1,2}\w+)*@\w+([-.]\w+)*\.\w+([-.]\w+)*$/i,value=input.value,result=true,length_value=value.length;if(reg.test(value)&&length_value>=1&&length_value<=40){result=true;}else{result=false;window.fpush({name:'MQL5+Popup+Register+Invalid+Email',unit:'section',value:'Articles'});}return result;};mqGlobal.AddOnReady(function(){var username=$('PopupRegisterusername'),email=$('PopupRegisteremail');if(username)username.value='';if(email)email.value='';});mqGlobal.AddOnReady(function(){window.quickLogin=new QuickLogin('Popup+Login','Articles');});mqGlobal.AddOnLoad(function(){window.showLoginRegisterPopupAtEnd();});mqGlobal.AddOnLoad(function(){window.tooltipUserInfo.init();});mqGlobal.AddOnReady(function(){{window.initHeaderSearch('','https://www.mql5.com/en/search');}});</script><script type="text/javascript">mqGlobal.AddOnReady(function(){window.initSuggestions("headerSearchKeyword","en","https://search.mql5.com/api/query","https://www.mql5.com/en/users_search/suggestion");});window.fz("show","bfogggabsofabcpxuzmgaibarmaxasdrj");window.fz("show","vgckrufggwxdtfscpyalmenexmvhljduja");mqGlobal.AddOnReady(function(){window.floatVerticalPanelNode=FloatVerticalPanel('This website uses cookies. Learn more about our <a href="/en/about/cookies">Cookies Policy</a>.','cookie_accept');});mqGlobal.AddOnReady(function(){window.initAddCopyButtonsToCodes('Copy to Clipboard');});							if (typeof Attach !== "undefined")
			Attach.setAcceptFilter(".zip, .txt, .log, .mqh, .ex5, .mq5, .mq4, .mqproj, .ex4, .mt5, .set, .tpl, .cl, .py, .sqlite, .csv, .ini, .ipynb, .onnx, .gif, .png, .jpg, .jpeg, .webp, .mp4, .webm");
	</script>

<script type="application/ld&#x2B;json">
		[
			{
				"@context": "https://schema.org",
				"@type": "Organization",
				"url": "https://www.mql5.com",
				"logo": "https://c.mql5.com/i/community/logo_mql5-2.png",
				"sameAs": [
					"https://www.facebook.com/mql5.community",
					"https://www.x.com/mql5com",
					"https://www.youtube.com/user/MetaQuotesOfficial"
				 ]
			}
		
, 
{"@context":"https://schema.org","@type":"ItemList","itemListElement":[{"@type":"SiteNavigationElement","position":1,"name":"Forum","description":"Discussions of trading strategies and algorithmic trading. MQL5.community  the largest forex forum","url":"https://www.mql5.com/en/forum","children":[]},{"@type":"SiteNavigationElement","position":2,"name":"Market","description":"MetaTrader Market - a Market of trading robots, indicators, trading books and magazines","url":"https://www.mql5.com/en/market","children":[]},{"@type":"SiteNavigationElement","position":3,"name":"Signals","description":"Social trading, copy trading and account monitoring with MetaTrader - Trading Signals on MQL5.com","url":"https://www.mql5.com/en/signals","children":[]},{"@type":"SiteNavigationElement","position":4,"name":"Freelance","description":"Order trading robots, technical indicators and algorithmic trading applications. Forex jobs. Freelance on MQL5.com. Hire MetaTrader experts and specialists","url":"https://www.mql5.com/en/job","children":[]},{"@type":"SiteNavigationElement","position":5,"name":"Quotes","description":"","url":"https://www.mql5.com/en/quotes/overview","children":[]},{"@type":"SiteNavigationElement","position":6,"name":"MetaTrader","description":"","url":"https://www.metatrader.com","children":[]},{"@type":"SiteNavigationElement","position":7,"name":"WebTerminal","description":"WebTerminal for the MetaTrader trading platform. Online forex trading.","url":"https://web.metatrader.app/terminal?mode=demo","children":[]},{"@type":"SiteNavigationElement","position":8,"name":"Calendar","description":"","url":"https://www.mql5.com/en/economic-calendar","children":[]},{"@type":"SiteNavigationElement","position":9,"name":"VPS","description":"","url":"https://www.mql5.com/en/vps","children":[]},{"@type":"SiteNavigationElement","position":10,"name":"Articles","description":"","url":"https://www.mql5.com/en/articles","children":[]},{"@type":"SiteNavigationElement","position":11,"name":"CodeBase","description":"Download trading robots, technical indicators and scripts with source code - MQL5 Code Base for MetaTrader 5","url":"https://www.mql5.com/en/code","children":[]},{"@type":"SiteNavigationElement","position":12,"name":"Algo Forge","description":"","url":"https://forge.mql5.io","children":[]},{"@type":"SiteNavigationElement","position":13,"name":"Documentation","description":"MetaQuotes Language 5 (MQL5) Reference - Documentation on MQL5.com","url":"https://www.mql5.com/en/docs","children":[]}]}		
,
{"@context":"https://schema.org","@type":"TechArticle","mainEntityOfPage":{"@type":"WebPage","@id":"https://www.mql5.com/en/articles/19944"},"headline":"Price Action Analysis Toolkit Development (Part 47): Tracking Forex Sessions and Breakouts in MetaTrader 5","image":["https://c.mql5.com/2/176/sessions.png","https://c.mql5.com/2/177/flowchart_o28.png","https://c.mql5.com/2/176/session_ea.gif","https://c.mql5.com/2/176/alert.gif"],"datePublished":"2025-10-27T09:43:49+00:00Z","dateModified":"2026-06-25T10:25:00+00:00Z","author":{"@type":"Person","name":"Christian Benjamin","url":"https://www.mql5.com/en/users/lynnchris"},"editor":{"@type":"Organization","name":"MetaQuotes","url":"https://www.mql5.com/en/users/metaquotes","address":{"@type":"PostalAddress","addressCountry":"CY"}},"publisher":{"@type":"Organization","name":"MQL5 Community","url":"https://www.mql5.com","logo":{"@type":"ImageObject","url":"https://c.mql5.com/i/community/logo_mql5-2.png"}},"description":"Global market sessions shape the rhythm of the trading day, and understanding their overlap is vital to timing entries and exits. In this article, well build an interactivetradingsessionsEA that brings those global hours to life directly on your chart. The EA automatically plots colorcoded rectangles for the Asia,Tokyo,London,andNewYork sessions, updating in real time as each market opens or closes. It features onchart toggle buttons, a dynamic information panel, and a scrolling ticker headline that streams live status and breakout messages. Tested on different brokers, this EA combines precision with stylehelping traders see volatility transitions, identify crosssession breakouts, and stay visually connected to the global markets pulse."}
,
{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"item":"https://www.mql5.com/en/articles","name":"Articles"},{"@type":"ListItem","position":2,"item":"https://www.mql5.com/en/articles/mt5","name":"MetaTrader 5"},{"@type":"ListItem","position":3,"item":"https://www.mql5.com/en/articles/mt5/trading_systems","name":"Trading systems"}]}

		]
	</script>
</body>
</html>
