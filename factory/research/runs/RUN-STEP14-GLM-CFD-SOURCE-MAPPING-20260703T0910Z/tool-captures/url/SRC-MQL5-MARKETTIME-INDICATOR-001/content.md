<!DOCTYPE html>
<html lang="en">
<head>
  <meta http-equiv="X-UA-Compatible" content="IE=edge"/>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, minimum-scale=1.0">
  <meta http-equiv="x-dns-prefetch-control" content="on">
  <link rel="dns-prefetch" href="https://c.mql5.com">
  <meta name="robots" content="max-snippet:250,max-image-preview:large">
  <meta name="description" content="MarketTime v1.10: Professional Multi-Timezone Clock &amp;amp; Session Indicator - Complete Documentation Product Name: MarketTime Version: 1.10 Type: MetaTrader 5 Indicator Author: Kaan Çalışkan Product">
  <meta property="og:url" content="https://www.mql5.com/en/blogs/post/767099">
  <meta property="og:title" content="MarketTime v1.10: Professional Multi-Timezone Clock &amp; Session Indicator - Complete Documentation">
  <meta property="og:description" content="MarketTime v1.10: Professional Multi-Timezone Clock &amp;amp; Session Indicator - Complete Documentation Product Name: MarketTime Version: 1.10 Type: MetaTrader 5 Indicator Author: Kaan Çalışkan Product">
      <meta property="og:image" content="https://c.mql5.com/i/og/mql5-blogs.png">
      <meta property="og:image:secure_url" content="https://c.mql5.com/i/og/mql5-blogs.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:type" content="blog">
  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:site" content="@mql5com">
  <meta name="twitter:image" content="https://c.mql5.com/i/og/mql5-blogs.png">
  <meta name="theme-color" content="#4a76b8">
  <meta name="format-detection" content="telephone=no">
  <link rel="manifest" href="https://www.mql5.com/manifest.json">
  <link rel="apple-touch-icon" sizes="57x57" href="https://www.mql5.com/apple-touch-icon-57x57.png">
  <link rel="apple-touch-icon" sizes="76x76" href="https://www.mql5.com/apple-touch-icon-76x76.png">
  <link rel="apple-touch-icon" sizes="120x120" href="https://www.mql5.com/apple-touch-icon-120x120.png">
  <link rel="apple-touch-icon" sizes="152x152" href="https://www.mql5.com/apple-touch-icon-152x152.png">
  <link rel="apple-touch-icon" sizes="167x167" href="https://www.mql5.com/apple-touch-icon-167x167.png">
  <link rel="apple-touch-icon" sizes="180x180" href="https://www.mql5.com/apple-touch-icon-180x180.png">
  <link rel="apple-touch-icon" sizes="192x192" href="https://www.mql5.com/apple-touch-icon-192x192.png">
  <link rel="icon" sizes="192x192" href="https://www.mql5.com/android-touch-icon-192x192.png">
  <link rel="icon" sizes="128x128" href="https://www.mql5.com/android-touch-icon-128x128.png">
  <link rel="shortcut icon" href="https://c.mql5.com/i/favicon4.ico">
  <meta name="msapplication-config" content="none"/>
  <meta name="referrer" content="no-referrer-when-downgrade">
  <meta property="qc:admins" content="36367170677651456375"/>
  <meta property="wb:webmaster" content="073d7690269bcd81"/>
  <link href="https://c.mql5.com/styles/core.a642a7a2c66884681225fd5196b1424e.css" type="text/css" rel="stylesheet" media="all">
  <link href="https://c.mql5.com/styles/all.9b04041c43d820f8adc7f870ba0b5a01.css" type="text/css" rel="stylesheet" media="all">
  <link href="https://c.mql5.com/styles/blogs.6c1c67b4a90c214a70212800ca0167f6.css" type="text/css" rel="stylesheet" media="all">
  <link href="/en/blogs/rss" rel="alternate" type="application/rss+xml" title="Trading blogs and financial markets analysis">
  <link rel="canonical" href="https://www.mql5.com/en/blogs/post/767099">
  <title>MarketTime v1.10: Professional Multi-Timezone Clock &amp; Session Indicator - Complete Documentation - Trading Strategies - 1 February 2026 - Traders&#x27; Blogs</title>
  <script type='text/javascript'>
  (function(a,e,f,g,b,c,d){a[b]||(a.FintezaCoreObject=b,a[b]=a[b]||function(){(a[b].q=a[b].q||[]).push(arguments)},a[b].l=1*new Date,c=e.createElement(f),d=e.getElementsByTagName(f)[0],c.async=!0,c.defer=!0,c.src=g,d&&d.parentNode&&d.parentNode.insertBefore(c,d))})
      (window, document, "script", "/ff/core.js", "fz");
  window.fz("register", "website", {
      id: "sqjxkxkswybhifrohpyooonwgbvsfzmayq",
    trackLinks: true,
    sendEventsByBeacon: true,
  });
  </script>


<script type="text/javascript">
  !function(){window.mqGlobal={};var t=!1,n=!1,e=[],o=[],i=[];function d(t){var n;for(n=0;n<t.length;n+=1)t[n]()}function c(){t||(t=!0,d(e),d(o),o=[],e=[])}function a(){c(),n||(n=!0,d(i),i=[])}if(mqGlobal.AddOnReady=function(n,i){t?n(document):i?e.push(n):o.push(n)},mqGlobal.AddOnLoad=function(t){n?t(document):i.push(t)},mqGlobal.AddOnActiveWindowChange=function(t){this._onvisibility||(this._onvisibility=[]),this._onvisibility[this._onvisibility.length]=t},document.addEventListener)document.addEventListener("DOMContentLoaded",c,!1),window.addEventListener("load",a,!1);else if(document.attachEvent&&(document.attachEvent("onreadystatechange",(function(){switch(document.readyState){case"interactive":c();break;case"complete":a()}})),window.attachEvent("onload",a),document.documentElement.doScroll&&window==window.top)){!function n(){if(!t&&document.body)try{document.documentElement.doScroll("left"),c()}catch(t){setTimeout(n,0)}}()}}();
  mqGlobal.CookieDomain = ".mql5.com";
  mqGlobal.Language = 'en';
  mqGlobal.IsMobile = false;
  mqGlobal.ClearRteStorage = function (e) { if (window.GStorage || (window.GStorage = globalStorage()), window.GStorage.supported) try { var o = e; window.GStorage.getItem("rte_autosave_uid", function (e, t) { t == o && (window.GStorage.removeItem("rte_autosave_text"), window.GStorage.removeItem("rte_autosave_date"), window.GStorage.removeItem("rte_autosave_uid")) }) } catch (e) { } };
</script>
  


    <script src="https://c.mql5.com/js/all.f8625696240796e75a49b2616f4c5894.js" type="text/javascript" defer="defer"></script>
  <script src="https://c.mql5.com/js/vendor.39da41eb444456418e5e53cc110d1b68.js" type="text/javascript" defer="defer"></script>
  <script src="https://c.mql5.com/js/blogs.2458ac8a54532bd95d41af7bf8c708cb.js" type="text/javascript" defer="defer"></script>


</head>

<body>

<div class="cover" id="cover">

    <header class="head">
      <a href="https://www.mql5.com" class="head__logo" title="MQL5 - Language of trade strategies built-in the MetaTrader 5 client terminal"></a>
        <div class="head__content">
          <nav class="main-menu" id="mainmenu">
            
                    <ul class="main-menu__top-level" id="menuTopLevel">
                    <li><a href="/en/forum" data-fz-event="MQL5+Menu+Forum">Forum</a></li>
                    <li><a href="/en/market" data-fz-event="MQL5+Menu+Market">Market</a></li>
                    <li><a href="/en/signals" data-fz-event="MQL5+Menu+Signals">Signals</a></li>
                    <li><a href="/en/job" data-fz-event="MQL5+Menu+Job">Freelance</a></li>
                    <li><a href="/en/vps" data-fz-event="MQL5+Menu+VPS">VPS</a></li>
                    <li><a href="/en/quotes/overview" data-fz-event="MQL5+Menu+Overview">Quotes</a></li>
                    <li><a href="https://www.metatrader.com" target="_blank" rel="noopener" data-fz-event="MQL5+Menu+MetaTrader">MetaTrader</a></li>
                  </ul><ul class="main-menu__second-level" id="menuSecondLevel">
                    <li><a href="/en/articles" data-fz-event="MQL5+Menu+Articles"><img src="https://c.mql5.com/i/menu/icon-articles4.svg" alt="" width="16" height="16"/>Articles</a></li>
                    <li><a href="/en/code" data-fz-event="MQL5+Menu+CodeBase"><img src="https://c.mql5.com/i/menu/icon-code4.svg" alt="" width="16" height="16"/>CodeBase</a></li>
                    <li><a href="https://forge.mql5.io/?lang=en" target="_blank" rel="noopener" data-fz-event="MQL5+Menu+AlgoForge"><img src="https://c.mql5.com/i/menu/icon-algoforge4.svg" alt="" width="16" height="16"/>Algo Forge</a></li>
                    <li><a href="/en/docs" data-fz-event="MQL5+Menu+Docs"><img src="https://c.mql5.com/i/menu/icon-docs4.svg" alt="" width="16" height="16"/>Documentation</a></li>
                    <li><a href="/en/book" data-fz-event="MQL5+Menu+Book"><img src="https://c.mql5.com/i/menu/icon-book4.svg" alt="" width="16" height="16"/>AlgoBook</a></li>
                    <li><a href="/en/neurobook" data-fz-event="MQL5+Menu+Neurobook"><img src="https://c.mql5.com/i/menu/icon-neurobook4.svg" alt="" width="16" height="16"/>NeuroBook</a></li>
                    <li><a href="/en/economic-calendar" data-fz-event="MQL5+Menu+Economic+Calendar"><img src="https://c.mql5.com/i/menu/icon-economic-calendar4.svg" alt="" width="16" height="16"/>Calendar</a></li>
                    <li><a href="https://web.metatrader.app/terminal?mode=demo&lang=en" target="_blank" rel="nofollow noopener" data-fz-event="MQL5+Menu+Trading"><img src="https://c.mql5.com/i/menu/icon-trading4.svg" alt="" width="16" height="16"/>WebTerminal</a></li>
                    <li class="main-menu__mobile"><a href="/en/about">About</a></li>
                    <li class="main-menu__second-tools"><a rel="noopener" href="/en/vps" title="Reliable trader hosting for uninterrupted operation of robots and instant copying of trades" class="button-mt" data-vars-fz="Start+VPS+Trial+Submenu"><img width="18" height="18" src="https://c.mql5.com/i/sidebar/vpstrial2.svg" alt="" loading="lazy">Start VPS Trial</a></li>
                    </ul>
          </nav>
            <div class="main-menu__active">
              <a id="mainMenuSelected" href="#">
                Home
              </a>
            </div>
<form action="https://www.mql5.com/en/search" onsubmit="return false;" autocomplete="off" id="headerSearchForm" class="header-search" method="post">
<button type="button" id="headerSearchButton" title="Search" class="header-search__button"></button><div class="header-search__input"><input name="keyword" type="text" enterkeyhint="search" title="Enter search text" placeholder="Search" id="headerSearchKeyword"/><label for="headerSearchKeyword" class="header-search__placeholder">Type <span>/</span> to search:  @user, $symbol, ...</label><button id="headerSearchSubmit" class="header-search__submit"></button></div><button type="button" id="headerSearchClean" title="Close" class="header-search__clean"></button></form>          <input class="blurHandler" id="mainMenuBlurHandler" type="checkbox">
        </div>
        <div class="head__toolbar" id="headerToolbar">
            <div class="container loginRegister">
              <nav>
                <ul id="loginRegisterButtons"><li><a class="login" title="Please sign in. OpenID supported" href="https://www.mql5.com/en/auth_login" rel="nofollow" data-fz-event="MQL5+Menu+Siginin">Log in</a></li><li><a class="registration en" title="Please register" href="https://www.mql5.com/en/auth_register" rel="nofollow" data-fz-event="MQL5+Menu+Register" onclick="window.fpush('MQL5+Button+Click');">Create an account</a></li></ul>
              </nav>
            </div>
          <div class="container">
            <div class="toggle-button" id="sidebarToggleButton">
              <i></i>
            </div>
          </div>

          <div class="group-menu" id="groupMenu">


            <div class="container lang-menu-container">
              <div id="langMenuContainer" class="lang-menu">
                <input class="blurHandler" id="langmenuBlurHandler" type="checkbox">
                <nav>
                  <ul class="lang-menu__list" id="langmenu">
                    <li class="lang-menu__list-item lang-menu__list-item_selected"><a href="/en/blogs" aria-label="English (English)"><i class="icons-languages icons-languages_en"></i><span>English</span></a></li>
<li class="lang-menu__list-item"><a href="/ru/blogs" aria-label="Русский (Russian)"><i class="icons-languages icons-languages_ru"></i><span>Русский</span></a></li>
<li class="lang-menu__list-item"><a href="/zh/blogs" aria-label="中文 (Chinese)"><i class="icons-languages icons-languages_zh"></i><span>中文</span></a></li>
<li class="lang-menu__list-item"><a href="/es/blogs" aria-label="Español (Spanish)"><i class="icons-languages icons-languages_es"></i><span>Español</span></a></li>
<li class="lang-menu__list-item"><a href="/pt/blogs" aria-label="Português (Portuguese)"><i class="icons-languages icons-languages_pt"></i><span>Português</span></a></li>
<li class="lang-menu__list-item"><a href="/ja/blogs" aria-label="日本語 (Japanese)"><i class="icons-languages icons-languages_ja"></i><span>日本語</span></a></li>
<li class="lang-menu__list-item"><a href="/de/blogs" aria-label="Deutsch (German)"><i class="icons-languages icons-languages_de"></i><span>Deutsch</span></a></li>
<li class="lang-menu__list-item"><a href="/ko/blogs" aria-label="한국어 (Korean)"><i class="icons-languages icons-languages_ko"></i><span>한국어</span></a></li>
<li class="lang-menu__list-item"><a href="/fr/blogs" aria-label="Français (French)"><i class="icons-languages icons-languages_fr"></i><span>Français</span></a></li>
<li class="lang-menu__list-item"><a href="/it/blogs" aria-label="Italiano (Italian)"><i class="icons-languages icons-languages_it"></i><span>Italiano</span></a></li>
<li class="lang-menu__list-item"><a href="/tr/blogs" aria-label="Türkçe (Turkish)"><i class="icons-languages icons-languages_tr"></i><span>Türkçe</span></a></li>

                  </ul>
                </nav>
              </div>
            </div>
          </div>
        </div>
    </header>

  <main>
<div id='bfogggabsofabcpxuzmgaibarmaxasdrj' class="r7pzo6pdelze088su g0j5459ml"></div>
    <article class="body" id="bodyContent">
      <header class="top-band">
        
    
    <div class="path path__blogs">
      <div class="shortlinks">
          <span>
            <a href="/en/blogs" title="All Blogs"><span>All Blogs</span></a>
          </span>
          /
          <span>
            <a href="/en/blogs/trading" title="My Trading"><span>My Trading</span></a>
          </span>
            /
            <span>
              <a href="/en/blogs/trading/strategies" title="Trading Strategies"><span>Trading Strategies</span></a>
            </span>
      </div>
    </div>
  <div style="clear:both;"></div>

      </header>

      


<div class="blogs">
  <div id="left-panel" class="left-panel left-panel_270  column left">
    
<div class="treeReadWrapper treeReadWrapper_blogs">
  <ul class="treeMenuRoot"><li><a href="/en/blogs" class="blogsCategory"><span class="inLink"><i></i>All Blogs</span></a></li></ul>
<ul class="treeMenuRoot blogs"><li><a href="/en/blogs/analytics" class="blogsCategory"><span class="inLink"><i style="background-position: 0 -48px"></i>Analytics & Forecasts</span></a><ul class="treeMenuRoot nodelim"><li><a href="/en/blogs/analytics/trends" class="blogsCategory"><span class="inLink"><i style="background-position: 0 -48px"></i>Weekly Trends</span></a></li><li><a href="/en/blogs/analytics/forecasts" class="blogsCategory"><span class="inLink"><i style="background-position: 0 -48px"></i>Forecasts</span></a></li><li><a href="/en/blogs/analytics/trading-systems" class="blogsCategory"><span class="inLink"><i style="background-position: 0 -48px"></i>Trading Systems</span></a></li></ul></li><li><a href="/en/blogs/trading" class="blogsCategory"><span class="inLink"><i style="background-position: 0 -64px"></i>My Trading</span></a><ul class="treeMenuRoot nodelim"><li><a href="/en/blogs/trading/charts" class="blogsCategory"><span class="inLink"><i style="background-position: 0 -64px"></i>Charts</span></a></li><li class="selected"><a href="/en/blogs/trading/strategies" class="blogsCategory"><span class="inLink"><i style="background-position: 0 -64px"></i>Trading Strategies</span></a></li><li><a href="/en/blogs/trading/statistics" class="blogsCategory"><span class="inLink"><i style="background-position: 0 -64px"></i>Statistics</span></a></li></ul></li><li><a href="/en/blogs/ideas" class="blogsCategory"><span class="inLink"><i style="background-position: 0 -80px"></i>Trading Ideas</span></a><ul class="treeMenuRoot nodelim"><li><a href="/en/blogs/ideas/scalping" class="blogsCategory"><span class="inLink"><i style="background-position: 0 -80px"></i>Scalping</span></a></li><li><a href="/en/blogs/ideas/neural-networks" class="blogsCategory"><span class="inLink"><i style="background-position: 0 -80px"></i>Neural Networks</span></a></li><li><a href="/en/blogs/ideas/wave-count" class="blogsCategory"><span class="inLink"><i style="background-position: 0 -80px"></i>Wave Count</span></a></li></ul></li><li><a href="/en/blogs/markets" class="blogsCategory"><span class="inLink"><i style="background-position: 0 -16px"></i>Market News</span></a><ul class="treeMenuRoot nodelim"><li><a href="/en/blogs/markets/currency" class="blogsCategory"><span class="inLink"><i style="background-position: 0 -16px"></i>Currency</span></a></li><li><a href="/en/blogs/markets/metals" class="blogsCategory"><span class="inLink"><i style="background-position: 0 -16px"></i>Metals</span></a></li><li><a href="/en/blogs/markets/crude-oil" class="blogsCategory"><span class="inLink"><i style="background-position: 0 -16px"></i>Crude Oil</span></a></li></ul></li><li><a href="/en/blogs/companies" class="blogsCategory"><span class="inLink"><i style="background-position: 0 -32px"></i>Company News</span></a><ul class="treeMenuRoot nodelim"><li><a href="/en/blogs/companies/events" class="blogsCategory"><span class="inLink"><i style="background-position: 0 -32px"></i>Events</span></a></li><li><a href="/en/blogs/companies/banks" class="blogsCategory"><span class="inLink"><i style="background-position: 0 -32px"></i>Banks</span></a></li><li><a href="/en/blogs/companies/brokers" class="blogsCategory"><span class="inLink"><i style="background-position: 0 -32px"></i>Brokers</span></a></li><li><a href="/en/blogs/companies/law" class="blogsCategory"><span class="inLink"><i style="background-position: 0 -32px"></i>Law/Regulations</span></a></li></ul></li><li><a href="/en/blogs/other" class="blogsCategory"><span class="inLink"><i style="background-position: 0 0px"></i>Other</span></a></li></ul>


    <ul class="treeMenuRoot">
      <li><a class="blogCategory terms" href="/en/blogs/terms" target="_blank"><span class="inLink">Rules</span></a></li>
    </ul>
</div>

  </div>
    
  <div class="column center">
    <div class="postContent view">
      <div class="postHead nosplash">
            <div>
              <div class="caption">
                <div class="category"><a href="/en/blogs/trading/strategies">Trading Strategies</a></div>
                <h1>MarketTime v1.10: Professional Multi-Timezone Clock &amp; Session Indicator - Complete Documentation</h1>
                <div class="date">1 February 2026, 00:29</div>
              </div>
            </div>
        <div class="avatar">
          <img src="https://c.mql5.com/avatar/2026/2/698d0a1d-45bd.jpg"
               title="Kaan Caliskan" alt="Kaan Caliskan" loading="lazy" width="60" height="60">
        </div>
          <div class="author">
            <a class="author" href="/en/users/scalptime">Kaan Caliskan</a>
          </div>
        <div class="counters">
          <div class="commentsCounter" title="Comments">0<i class="icon comments"></i></div>
          <div class="viewsCounter" title="Views"><i class="icon views"></i>766</div>
        </div>
      </div>
      <div class="container">
        <div class="content">
          <h3>MarketTime v1.10: Professional Multi-Timezone Clock &amp; Session Indicator - Complete Documentation</h3> <p><strong>Product Name:</strong> MarketTime</p> <p><strong>Version:</strong> 1.10</p> <p><strong>Type:</strong> MetaTrader 5 Indicator</p> <p><strong>Author:</strong> Kaan Çalışkan</p> <p><strong>Product Link:</strong> <a href="/en/market/product/XXXXX">View on MQL5 Market</a></p> <h3>Introduction</h3> <p>MarketTime is a professional-grade multi-timezone clock and trading session indicator designed specifically for forex traders who need to monitor global market sessions, time zones, and symbol trading hours simultaneously. In the fast-paced world of forex trading, timing is everything. Understanding when major financial centers are active, when sessions overlap, and when your broker's symbol is open for trading can significantly impact your trading decisions and strategy execution.</p> <p>This comprehensive indicator displays real-time information across multiple time zones including Local, Broker, London (GMT), New York (EST), Tokyo (Asia), and custom time zones of your choice. It provides live countdowns to session opens and closes for London, New York, and Asian markets, shows your symbol's current trading status with next open/close information, and draws visual session zones directly on your chart with customizable colors and transparency.</p> <p>Whether you're a scalper who needs precise timing for high-liquidity session overlaps, a swing trader planning entries around major market opens, or a position trader monitoring global market hours, MarketTime provides all the time-critical information you need in one elegant, customizable panel. The indicator features a collapsible interface that saves screen space, draggable positioning for optimal placement on your charts, and extensive customization options for colors, fonts, and displayed information.</p> <p>MarketTime eliminates the need for multiple browser tabs, external applications, or mental calculations to track market hours. Everything you need is right on your chart, updating in real-time, with visual session zones that help you identify high-activity periods at a glance. This documentation will guide you through every feature, setting, and configuration option to help you get the most out of this powerful tool.</p> <h3>Part 1: Getting Started with MarketTime</h3> <h4>1.1 Installation</h4> <p>After purchasing or downloading MarketTime from the MQL5 Market, the indicator will automatically appear in your MetaTrader 5 Navigator panel. To install and use MarketTime:</p> <ul> <li>Open MetaTrader 5 platform</li> <li>Navigate to the "Navigator" panel (Ctrl+N if not visible)</li> <li>Expand the "Indicators" folder, then "Market" folder</li> <li>Locate "MarketTime" in the list</li> <li>Drag and drop MarketTime onto any chart window</li> <li>The settings dialog will appear with all configuration options</li> <li>Configure your preferences (or use defaults) and click "OK"</li> </ul> <p>The indicator panel will immediately appear on your chart, displaying current time information across all enabled time zones and session countdowns.</p> <h4>1.2 First Look: Understanding the Panel</h4> <p>When you first attach MarketTime to your chart, you'll see a professional dark-themed panel (colors are fully customizable) positioned in the upper-left corner by default. The panel is organized into several sections:</p> <ul> <li><strong>Header Section:</strong> Contains the "MarketTime" title and a collapse/expand button (▼/▲) for minimizing the panel</li> <li><strong>Time Display Section:</strong> Shows current time in multiple time zones (Local, Broker, London, New York, Tokyo, Custom)</li> <li><strong>Session Countdown Section:</strong> Displays time remaining until next session open or close for London, New York, and Asia</li> <li><strong>Symbol Info Section:</strong> Shows your current symbol's trading hours, open/closed status, and time to next open</li> <li><strong>Additional Info Section:</strong> Displays day of week, market status, spread, and other optional information</li> </ul> <p>The panel is fully interactive - you can click and drag it to reposition anywhere on your chart, and click the header button to collapse/expand the full information display.</p> <h4>1.3 Quick Start Configuration</h4> <p>For traders who want to get started quickly, here's a minimal configuration that works well for most forex traders:</p> <div class="code"> <p>Panel Settings:</p> <p>InpPanelX = 20 (left margin from chart edge)</p> <p>InpPanelY = 50 (top margin from chart edge)</p> <p>InpStartCollapsed = false (start with panel expanded)</p> <p></p> <p>Time Display Settings:</p> <p>InpTimeFormat = TIME_FORMAT_24H (24-hour format)</p> <p>InpShowSeconds = true (display seconds)</p> <p>InpShowLocalTime = true (your computer's time zone)</p> <p>InpShowBrokerTime = true (your broker's server time)</p> <p>InpShowLondonTime = true (GMT/London time)</p> <p>InpShowNewYorkTime = true (EST/EDT New York time)</p> <p>InpShowTokyoTime = true (JST Tokyo time)</p> <p></p> <p>Session Countdown Settings:</p> <p>InpShowLondonCountdown = true</p> <p>InpShowNYCountdown = true</p> <p>InpShowAsiaCountdown = true</p> <p></p> <p>Session Zone Settings:</p> <p>InpDrawSessionZones = true (draw colored zones on chart)</p> <p>InpDrawLondonZone = true</p> <p>InpDrawNewYorkZone = true</p> <p>InpDrawAsiaZone = true</p> <p>InpDrawOverlapZone = true (highlight session overlaps)</p> </div> <p>This configuration gives you a complete view of global market hours with visual session zones on your chart, making it easy to identify trading opportunities during high-liquidity periods.</p> <h3>Part 2: Panel Settings - Appearance and Positioning</h3> <h4>2.1 Panel Position Settings</h4> <p>MarketTime allows you to position the panel anywhere on your chart using pixel coordinates:</p> <div class="code"> <p>InpPanelX = 20 (Default: 20)</p> <p>Range: 0 to chart width</p> <p>Description: Horizontal position in pixels from left edge of chart</p> <p></p> <p>InpPanelY = 50 (Default: 50)</p> <p>Range: 0 to chart height</p> <p>Description: Vertical position in pixels from top edge of chart</p> </div> <p><strong>Usage Tips:</strong> The panel is also draggable, so you can click and drag it to any position after it's loaded. The X and Y values are used for the initial position when the indicator first loads. If you want the panel in the upper-right corner, set InpPanelX to a high value like 1500 (it will automatically adjust to your screen). For bottom placement, set InpPanelY to a high value like 800.</p> <h4>2.2 Panel Color Customization</h4> <p>Every color element in the MarketTime panel can be customized to match your chart theme or personal preferences:</p> <div class="code"> <p>InpPanelBgColor = C'25,25,35' (Default: Dark blue-gray)</p> <p>Description: Main panel background color</p> <p>Example: C'0,0,0' for black, C'255,255,255' for white</p> <p></p> <p>InpPanelBorderColor = C'60,60,80' (Default: Medium blue-gray)</p> <p>Description: Panel border outline color</p> <p></p> <p>InpHeaderColor = C'35,35,50' (Default: Slightly darker blue-gray)</p> <p>Description: Header section background color (where title and collapse button appear)</p> <p></p> <p>InpTextColor = clrWhite (Default: White)</p> <p>Description: Main text color for time displays and information</p> <p></p> <p>InpLabelColor = C'150,150,170' (Default: Light gray)</p> <p>Description: Label text color (for "Local:", "London:", etc.)</p> <p></p> <p>InpCountdownColor = clrLime (Default: Bright green)</p> <p>Description: Color for active countdown timers</p> <p></p> <p>InpSessionActiveColor = clrGold (Default: Gold/Yellow)</p> <p>Description: Color used when a session is currently active/open</p> </div> <p><strong>Color Format:</strong> MetaTrader 5 supports colors in multiple formats. You can use predefined color names (clrWhite, clrBlack, clrRed, etc.) or custom RGB values using the C'R,G,B' format where R, G, and B are values from 0 to 255. For example, C'255,0,0' is pure red, C'0,255,0' is pure green, and C'128,128,128' is medium gray.</p> <p><strong>Theme Examples:</strong></p> <div class="code"> <p>Dark Theme (Default):</p> <p>InpPanelBgColor = C'25,25,35'</p> <p>InpTextColor = clrWhite</p> <p>InpLabelColor = C'150,150,170'</p> <p></p> <p>Light Theme:</p> <p>InpPanelBgColor = C'240,240,245'</p> <p>InpTextColor = clrBlack</p> <p>InpLabelColor = C'80,80,100'</p> <p></p> <p>Blue Theme:</p> <p>InpPanelBgColor = C'15,30,60'</p> <p>InpHeaderColor = C'25,40,70'</p> <p>InpPanelBorderColor = C'50,100,180'</p> </div> <h4>2.3 Font and Text Settings</h4> <div class="code"> <p>InpFontSize = 9 (Default: 9)</p> <p>Range: 6 to 20 recommended</p> <p>Description: Size of all text in the panel</p> <p></p> <p>InpFontName = "Consolas" (Default: Consolas)</p> <p>Description: Font family for all text</p> <p>Options: Any font installed on your system</p> <p>Popular choices: "Arial", "Courier New", "Tahoma", "Verdana", "Consolas"</p> </div> <p><strong>Font Recommendations:</strong> Monospace fonts like "Consolas" or "Courier New" work best for time displays because all digits have the same width, preventing the panel from shifting as numbers change. For a cleaner modern look, "Arial" or "Segoe UI" work well. Avoid decorative fonts as they may reduce readability.</p> <h4>2.4 Collapse/Expand Functionality</h4> <div class="code"> <p>InpStartCollapsed = false (Default: false)</p> <p>Options: true or false</p> <p>Description: Whether the panel starts in collapsed (minimized) state</p> </div> <p>When set to <strong>true</strong>, only the panel header with the title "MarketTime" and the expand button (▲) will be visible when the indicator loads. This is useful if you want the time information available but don't need it constantly displayed. You can click the button to expand the full panel at any time.</p> <p>When set to <strong>false</strong> (default), the panel loads fully expanded with all information visible. You can still collapse it by clicking the collapse button (▼) in the header.</p> <h3>Part 3: Time Display Settings - Multiple Time Zones</h3> <h4>3.1 Time Format Selection</h4> <div class="code"> <p>InpTimeFormat = TIME_FORMAT_24H (Default: 24-hour)</p> <p>Options:</p> <p>TIME_FORMAT_12H = 12-Hour format with AM/PM</p> <p>TIME_FORMAT_24H = 24-Hour military format</p> </div> <p><strong>12-Hour Format Example:</strong> 09:30:45 PM</p> <p><strong>24-Hour Format Example:</strong> 21:30:45</p> <p>Most professional traders prefer the 24-hour format as it eliminates AM/PM confusion and is standard in international markets. However, if you're more comfortable with 12-hour time, the indicator fully supports it with clear AM/PM indicators.</p> <h4>3.2 Seconds Display</h4> <div class="code"> <p>InpShowSeconds = true (Default: true)</p> <p>Options: true or false</p> <p>Description: Whether to show seconds in time displays</p> </div> <p>When <strong>enabled</strong>, all times show in HH:MM:SS format (or HH:MM:SS AM/PM in 12-hour mode). When <strong>disabled</strong>, times show in HH:MM format. Disabling seconds makes the display more compact and reduces visual updates, but you lose precision timing information.</p> <h4>3.3 Standard Time Zones</h4> <p>MarketTime can display up to six different time zones simultaneously. Each can be independently enabled or disabled:</p> <div class="code"> <p>InpShowLocalTime = true (Default: true)</p> <p>Description: Shows your computer's local time zone</p> <p>Label: "Local:"</p> <p></p> <p>InpShowBrokerTime = true (Default: true)</p> <p>Description: Shows your broker's server time (MetaTrader server time)</p> <p>Label: "Broker:"</p> <p></p> <p>InpShowLondonTime = true (Default: true)</p> <p>Description: Shows London/GMT time (UTC+0)</p> <p>Label: "London:"</p> <p>Note: Automatically adjusts for British Summer Time (BST/UTC+1)</p> <p></p> <p>InpShowNewYorkTime = true (Default: true)</p> <p>Description: Shows New York/Eastern time (EST/EDT)</p> <p>Label: "New York:"</p> <p>Note: Automatically adjusts for Daylight Saving Time</p> <p></p> <p>InpShowTokyoTime = true (Default: true)</p> <p>Description: Shows Tokyo/Japan time (JST/UTC+9)</p> <p>Label: "Tokyo:"</p> <p>Note: Japan does not observe DST, always UTC+9</p> </div> <p><strong>Why These Time Zones Matter:</strong></p> <ul> <li><strong>Local Time:</strong> Your personal reference time for coordinating with your daily schedule</li> <li><strong>Broker Time:</strong> Critical for understanding when your broker's trading day starts/ends, used for daily candle close times</li> <li><strong>London Time:</strong> GMT is the base reference for forex market hours, London session is one of the most liquid periods</li> <li><strong>New York Time:</strong> The New York session has the highest trading volume, and the London-New York overlap is the most active period</li> <li><strong>Tokyo Time:</strong> Represents the Asian session, important for traders focusing on JPY pairs and Asian market activity</li> </ul> <h4>3.4 Custom Time Zone</h4> <p>In addition to the five standard time zones, MarketTime allows you to add one custom time zone of your choice:</p> <div class="code"> <p>InpShowCustomTime = false (Default: false)</p> <p>Description: Enable/disable custom timezone display</p> <p></p> <p>InpCustomTimezone = TZ_UTC_P3 (Default: UTC+3)</p> <p>Description: The UTC offset for your custom timezone</p> <p></p> <p>InpCustomTimezoneName = "Custom" (Default: "Custom")</p> <p>Description: Label text that appears before the time</p> <p>Example: "Dubai", "Sydney", "Mumbai", etc.</p> </div> <p><strong>Available Custom Time Zones (Full List):</strong></p> <div class="code"> <p>TZ_UTC_M12 = UTC-12:00 (Baker Island)</p> <p>TZ_UTC_M11 = UTC-11:00 (American Samoa)</p> <p>TZ_UTC_M10 = UTC-10:00 (Hawaii)</p> <p>TZ_UTC_M9 = UTC-09:00 (Alaska)</p> <p>TZ_UTC_M8 = UTC-08:00 (Los Angeles, PST/PDT)</p> <p>TZ_UTC_M7 = UTC-07:00 (Denver, MST/MDT)</p> <p>TZ_UTC_M6 = UTC-06:00 (Chicago, CST/CDT)</p> <p>TZ_UTC_M5 = UTC-05:00 (New York, EST/EDT)</p> <p>TZ_UTC_M4 = UTC-04:00 (Halifax, AST/ADT)</p> <p>TZ_UTC_M3 = UTC-03:00 (Sao Paulo, BRT)</p> <p>TZ_UTC_M2 = UTC-02:00 (Mid-Atlantic)</p> <p>TZ_UTC_M1 = UTC-01:00 (Azores)</p> <p>TZ_UTC_0 = UTC+00:00 (London GMT, Reykjavik)</p> <p>TZ_UTC_P1 = UTC+01:00 (Paris, Berlin, CET)</p> <p>TZ_UTC_P2 = UTC+02:00 (Athens, Istanbul, EET)</p> <p>TZ_UTC_P3 = UTC+03:00 (Moscow, Turkey, TRT)</p> <p>TZ_UTC_P4 = UTC+04:00 (Dubai, GST)</p> <p>TZ_UTC_P5 = UTC+05:00 (Karachi, PKT)</p> <p>TZ_UTC_P530 = UTC+05:30 (Mumbai, IST)</p> <p>TZ_UTC_P6 = UTC+06:00 (Dhaka, BST)</p> <p>TZ_UTC_P7 = UTC+07:00 (Bangkok, ICT)</p> <p>TZ_UTC_P8 = UTC+08:00 (Singapore, Hong Kong, SGT)</p> <p>TZ_UTC_P9 = UTC+09:00 (Tokyo, Seoul, JST)</p> <p>TZ_UTC_P930 = UTC+09:30 (Adelaide, ACST)</p> <p>TZ_UTC_P10 = UTC+10:00 (Sydney, AEST)</p> <p>TZ_UTC_P11 = UTC+11:00 (Solomon Islands)</p> <p>TZ_UTC_P12 = UTC+12:00 (Auckland, NZST)</p> </div> <p><strong>Custom Time Zone Example:</strong> If you're based in Dubai and want to see Dubai time displayed, you would configure:</p> <div class="code"> <p>InpShowCustomTime = true</p> <p>InpCustomTimezone = TZ_UTC_P4</p> <p>InpCustomTimezoneName = "Dubai"</p> </div> <p>The panel will then show a line: <strong>Dubai: 14:30:45</strong> (or whatever the current Dubai time is).</p> <h3>Part 4: Session Countdown Settings</h3> <h4>4.1 Understanding Session Countdowns</h4> <p>One of MarketTime's most valuable features is the live countdown timers that show exactly how much time remains until the next major session opens or closes. These countdowns help you prepare for high-volatility periods, session transitions, and optimal trading windows.</p> <p>The indicator monitors three major forex sessions:</p> <ul> <li><strong>London Session:</strong> European market hours, highest liquidity for EUR and GBP pairs</li> <li><strong>New York Session:</strong> American market hours, highest overall trading volume</li> <li><strong>Asia Session:</strong> Asian/Pacific market hours, important for JPY, AUD, and NZD pairs</li> </ul> <p>For each session, the indicator displays whether the session is currently <strong>OPEN</strong> or <strong>CLOSED</strong>, and a countdown timer showing time remaining until the next state change.</p> <h4>4.2 Session Countdown Enable/Disable</h4> <div class="code"> <p>InpShowLondonCountdown = true (Default: true)</p> <p>Description: Show/hide London session countdown</p> <p></p> <p>InpShowNYCountdown = true (Default: true)</p> <p>Description: Show/hide New York session countdown</p> <p></p> <p>InpShowAsiaCountdown = true (Default: true)</p> <p>Description: Show/hide Asia session countdown</p> </div> <p>Each countdown can be independently enabled or disabled. If you only trade during the London and New York sessions, you can disable the Asia countdown to save panel space.</p> <h4>4.3 London Session Configuration</h4> <p>The London session times are configurable to match the actual trading hours you consider relevant:</p> <div class="code"> <p>InpLondonOpenHour = 8 (Default: 8)</p> <p>Range: 0 to 23</p> <p>Description: Hour when London session opens (in GMT)</p> <p></p> <p>InpLondonOpenMinute = 0 (Default: 0)</p> <p>Range: 0 to 59</p> <p>Description: Minute when London session opens</p> <p></p> <p>InpLondonCloseHour = 16 (Default: 16)</p> <p>Range: 0 to 23</p> <p>Description: Hour when London session closes (in GMT)</p> <p></p> <p>InpLondonCloseMinute = 30 (Default: 30)</p> <p>Range: 0 to 59</p> <p>Description: Minute when London session closes</p> </div> <p><strong>Default London Hours:</strong> 08:00 GMT to 16:30 GMT (8:00 AM to 4:30 PM London time)</p> <p><strong>Important Note:</strong> All session times are specified in GMT (Greenwich Mean Time / UTC+0). The indicator will automatically convert these times to your broker's time zone for display and zone drawing. During British Summer Time (BST), London is GMT+1, but you still configure the times in GMT - the indicator handles the DST adjustment automatically.</p> <h4>4.4 New York Session Configuration</h4> <div class="code"> <p>InpNewYorkOpenHour = 14 (Default: 14)</p> <p>Range: 0 to 23</p> <p>Description: Hour when New York session opens (in GMT)</p> <p></p> <p>InpNewYorkOpenMinute = 30 (Default: 30)</p> <p>Range: 0 to 59</p> <p>Description: Minute when New York session opens</p> <p></p> <p>InpNewYorkCloseHour = 21 (Default: 21)</p> <p>Range: 0 to 23</p> <p>Description: Hour when New York session closes (in GMT)</p> <p></p> <p>InpNewYorkCloseMinute = 0 (Default: 0)</p> <p>Range: 0 to 59</p> <p>Description: Minute when New York session closes</p> </div> <p><strong>Default New York Hours:</strong> 14:30 GMT to 21:00 GMT</p> <p>This corresponds to approximately 9:30 AM to 4:00 PM Eastern Time (the actual hours vary by DST). Some traders prefer to extend the New York session to 22:00 GMT to include after-hours activity.</p> <h4>4.5 Asia Session Configuration</h4> <div class="code"> <p>InpAsiaOpenHour = 0 (Default: 0)</p> <p>Range: 0 to 23</p> <p>Description: Hour when Asia session opens (in GMT)</p> <p></p> <p>InpAsiaOpenMinute = 0 (Default: 0)</p> <p>Range: 0 to 59</p> <p>Description: Minute when Asia session opens</p> <p></p> <p>InpAsiaCloseHour = 9 (Default: 9)</p> <p>Range: 0 to 23</p> <p>Description: Hour when Asia session closes (in GMT)</p> <p></p> <p>InpAsiaCloseMinute = 0 (Default: 0)</p> <p>Range: 0 to 59</p> <p>Description: Minute when Asia session closes</p> </div> <p><strong>Default Asia Hours:</strong> 00:00 GMT to 09:00 GMT (midnight to 9:00 AM GMT)</p> <p>This covers the Tokyo session which is the primary reference for Asian market hours. Some traders prefer to start the Asian session at 23:00 GMT (the previous day) to include the Sydney session open, or extend it to 10:00 GMT to include more Tokyo morning activity.</p> <h4>4.6 How Countdown Timers Work</h4> <p>The countdown display format is: <strong>London: OPEN - Closes in 5h 23m 45s</strong></p> <p>When a session is open, you'll see:</p> <ul> <li>Status: <strong>OPEN</strong> (displayed in the session active color, default: Gold)</li> <li>Next event: "Closes in..."</li> <li>Time remaining in hours, minutes, and seconds</li> </ul> <p>When a session is closed, you'll see:</p> <ul> <li>Status: <strong>CLOSED</strong></li> <li>Next event: "Opens in..."</li> <li>Time remaining in hours, minutes, and seconds</li> </ul> <p>The timers update every second in real-time, giving you precise awareness of when trading activity is likely to increase or decrease.</p> <h3>Part 5: Symbol Information Display</h3> <h4>5.1 Symbol Trading Hours</h4> <p>MarketTime displays real-time information about your current chart symbol's trading status. This is particularly valuable because not all symbols trade 24/5 like major forex pairs - some have specific trading hours, maintenance breaks, or weekly closures.</p> <div class="code"> <p>InpShowSymbolInfo = true (Default: true)</p> <p>Description: Enable/disable display of symbol trading hours</p> </div> <p>When enabled, this section shows the current symbol name and its designated trading schedule as reported by your broker. For example, a forex pair might show "24 hours" while a stock CFD might show "09:30-16:00 EST" or similar specific hours.</p> <h4>5.2 Symbol Open/Closed Status</h4> <div class="code"> <p>InpShowSymbolStatus = true (Default: true)</p> <p>Description: Show whether the symbol is currently open or closed for trading</p> </div> <p>This displays real-time information about whether you can currently place trades on this symbol. The status will show:</p> <ul> <li><strong>OPEN</strong> - Symbol is currently tradable, you can place market orders</li> <li><strong>CLOSED</strong> - Symbol is not currently tradable (weekend, holiday, maintenance, or outside trading hours)</li> </ul> <p>The status color changes based on the state - open symbols typically display in the session active color (gold by default), while closed symbols display in normal text color.</p> <h4>5.3 Time to Next Open</h4> <div class="code"> <p>InpShowNextOpen = true (Default: true)</p> <p>Description: Show countdown timer to when symbol will next open for trading</p> </div> <p>When the symbol is currently closed, this displays a countdown showing exactly how much time remains until the symbol becomes tradable again. For example:</p> <p><strong>Next Open: in 1d 3h 24m 15s</strong> (1 day, 3 hours, 24 minutes, 15 seconds)</p> <p>This is extremely useful during weekends when waiting for Monday market open, or when trading symbols with specific session hours.</p> <h4>5.4 Session Open/Close Times</h4> <div class="code"> <p>InpShowSessionTime = true (Default: true)</p> <p>Description: Display the exact open and close times for the current trading session</p> </div> <p>This shows the specific times when the current symbol's session opened (or will open) and when it will close. The times are displayed in your broker's server time for easy reference. Example display:</p> <p><strong>Opens: Monday 00:00</strong></p> <p><strong>Closes: Friday 23:59</strong></p> <p>For 24-hour forex symbols, this typically shows the weekly cycle (Monday open to Friday close). For symbols with daily sessions, it shows today's session times.</p> <h4>5.5 Symbol Info Practical Use Cases</h4> <p><strong>Forex Pairs:</strong> Most major pairs trade 24 hours weekdays. Symbol info confirms when the week starts/ends in your broker's time zone.</p> <p><strong>Stock CFDs:</strong> These have specific daily hours. Symbol info tells you exactly when you can trade, preventing missed opportunities or confusion about why orders aren't executing.</p> <p><strong>Commodities:</strong> Gold, silver, oil, etc., often have unique trading schedules with daily breaks. The countdown helps you prepare for reopening.</p> <p><strong>Cryptocurrency:</strong> While many crypto pairs trade 24/7, some have scheduled maintenance. Symbol status alerts you if trading is temporarily unavailable.</p> <h3>Part 6: Session Zone Drawing on Chart</h3> <h4>6.1 Understanding Session Zones</h4> <p>Session zones are colored rectangles drawn directly on your price chart that visually highlight when major trading sessions are active. These zones extend from the top to the bottom of your visible chart, making it instantly obvious which session(s) were active during any historical price movement.</p> <p>This visual representation helps you:</p> <ul> <li>Identify which sessions drove specific price movements</li> <li>See session overlaps where liquidity is highest (London + New York overlap is the most liquid period)</li> <li>Plan entries and exits around session opens and closes</li> <li>Backtest strategies by visually correlating patterns with session times</li> <li>Recognize how your trading pair behaves during different global sessions</li> </ul> <h4>6.2 Session Zone Master Control</h4> <div class="code"> <p>InpDrawSessionZones = true (Default: true)</p> <p>Description: Master on/off switch for all session zone drawing</p> </div> <p>When set to <strong>false</strong>, no session zones will be drawn on the chart regardless of individual session settings. This is useful if you want the time panel and countdowns but prefer a clean chart without colored zones.</p> <p>When set to <strong>true</strong>, the indicator will draw zones for each session that is individually enabled below.</p> <h4>6.3 Individual Session Zone Controls</h4> <div class="code"> <p>InpDrawLondonZone = true (Default: true)</p> <p>Description: Draw London session zones</p> <p></p> <p>InpDrawNewYorkZone = true (Default: true)</p> <p>Description: Draw New York session zones</p> <p></p> <p>InpDrawAsiaZone = true (Default: true)</p> <p>Description: Draw Asia session zones</p> <p></p> <p>InpDrawOverlapZone = true (Default: true)</p> <p>Description: Draw special zones highlighting session overlaps</p> </div> <p>Each session can be independently shown or hidden. For example, if you only trade the London-New York overlap, you could disable Asia zones while keeping London and New York zones visible.</p> <p><strong>Overlap Zones:</strong> When enabled, the indicator draws additional zones during periods when two major sessions are simultaneously active. The most important overlap is London + New York (roughly 13:30-16:30 GMT), which has the highest trading volume and volatility in forex markets.</p> <h4>6.4 Session Zone Colors</h4> <p>Each session has its own customizable color to help you distinguish between different market hours at a glance:</p> <div class="code"> <p>InpLondonZoneColor = C'0,100,150' (Default: Blue-teal)</p> <p>Description: Color for London session zones</p> <p></p> <p>InpNewYorkZoneColor = C'150,100,0' (Default: Orange-brown)</p> <p>Description: Color for New York session zones</p> <p></p> <p>InpAsiaZoneColor = C'100,0,100' (Default: Purple)</p> <p>Description: Color for Asia session zones</p> <p></p> <p>InpOverlapZoneColor = C'0,150,100' (Default: Teal-green)</p> <p>Description: Color for session overlap zones</p> </div> <p><strong>Color Selection Tips:</strong> Choose colors that contrast with your chart background and price candles, but aren't so bright that they distract from price action. The default colors are designed to be subtle yet distinguishable. If you have a light chart theme, use darker colors. For dark themes, lighter colors work better.</p> <p><strong>Recommended Color Schemes:</strong></p> <div class="code"> <p>Dark Chart Theme:</p> <p>InpLondonZoneColor = C'30,80,120' (Subtle blue)</p> <p>InpNewYorkZoneColor = C'120,80,30' (Subtle orange)</p> <p>InpAsiaZoneColor = C'80,30,80' (Subtle purple)</p> <p>InpOverlapZoneColor = C'30,100,80' (Subtle teal)</p> <p></p> <p>Light Chart Theme:</p> <p>InpLondonZoneColor = C'180,200,220' (Light blue)</p> <p>InpNewYorkZoneColor = C'220,200,180' (Light orange)</p> <p>InpAsiaZoneColor = C'200,180,200' (Light purple)</p> <p>InpOverlapZoneColor = C'180,220,200' (Light teal)</p> </div> <h4>6.5 Zone Transparency</h4> <div class="code"> <p>InpZoneTransparency = 85 (Default: 85)</p> <p>Range: 0 to 100</p> <p>Description: Transparency level of session zones</p> <p>0 = Fully visible (opaque)</p> <p>100 = Fully transparent (invisible)</p> </div> <p>This parameter controls how see-through the session zones are. Higher values make the zones more transparent, allowing you to see price action more clearly while still having the zones visible as a subtle background reference.</p> <p><strong>Recommended Values:</strong></p> <ul> <li><strong>70-80:</strong> Very subtle, barely noticeable unless you look for them</li> <li><strong>80-85:</strong> Default range, good balance between visibility and clarity</li> <li><strong>85-90:</strong> Very transparent, just a hint of color</li> <li><strong>50-70:</strong> More visible, zones are clearly present</li> <li><strong>Below 50:</strong> Very prominent, may interfere with chart reading</li> </ul> <h4>6.6 Historical Zone Display</h4> <div class="code"> <p>InpZoneDaysToShow = 5 (Default: 5)</p> <p>Range: 1 to 30</p> <p>Description: Number of past days to draw session zones for</p> </div> <p>This determines how far back in history the session zones are drawn. A value of 5 means zones will be drawn for today plus the previous 5 days. Higher values let you see session patterns further back in time, useful for backtesting or long-term analysis.</p> <p><strong>Recommended Values by Chart Timeframe:</strong></p> <ul> <li><strong>M1-M5 (Scalping):</strong> 1-3 days (zones on very short timeframes become crowded quickly)</li> <li><strong>M15-H1 (Intraday):</strong> 3-7 days (good balance of context without clutter)</li> <li><strong>H4-D1 (Swing Trading):</strong> 10-20 days (see multiple weeks of session patterns)</li> <li><strong>Weekly+ (Position Trading):</strong> 20-30 days (or set InpDrawSessionZones = false, less relevant at this scale)</li> </ul> <p><strong>Performance Note:</strong> Drawing zones for many days can slightly impact indicator performance, especially on lower timeframe charts. If you notice any slowdown, reduce this value.</p> <h3>Part 7: Additional Features and Information Display</h3> <h4>7.1 Day of Week Display</h4> <div class="code"> <p>InpShowDayOfWeek = true (Default: true)</p> <p>Description: Display current day of the week</p> </div> <p>When enabled, the panel shows the current day (Monday, Tuesday, Wednesday, etc.) based on your broker's server time. This helps you maintain context, especially important for weekly trading cycles and being aware of Friday closings or Monday openings.</p> <h4>7.2 Forex Market Status</h4> <div class="code"> <p>InpShowMarketStatus = true (Default: true)</p> <p>Description: Show overall forex market status (OPEN/CLOSED)</p> </div> <p>This displays whether the global forex market is currently open or closed. The market is considered:</p> <ul> <li><strong>OPEN:</strong> Sunday 21:00 GMT to Friday 21:00 GMT (approximately)</li> <li><strong>CLOSED:</strong> Friday evening to Sunday evening (weekend)</li> </ul> <p>This is a high-level indicator separate from individual symbol trading hours, representing the general state of the forex market as a whole.</p> <h4>7.3 Current Spread Display</h4> <div class="code"> <p>InpShowSpread = true (Default: true)</p> <p>Description: Display current bid-ask spread for the chart symbol</p> </div> <p>Shows the current spread in points/pips between the bid and ask price. This information updates in real-time and helps you:</p> <ul> <li>Identify when spreads widen (typically during low liquidity or news events)</li> <li>Determine optimal entry times (lower spreads reduce trading costs)</li> <li>Avoid trading during periods of abnormally high spreads</li> <li>Compare spread conditions across different sessions</li> </ul> <p>Example display: <strong>Spread: 1.2 pips</strong></p> <h4>7.4 Server Latency/Ping Display</h4> <div class="code"> <p>InpShowServerPing = false (Default: false)</p> <p>Description: Show estimated connection latency to broker server</p> </div> <p>When enabled, displays an approximate ping time (in milliseconds) to your broker's server. This is useful for:</p> <ul> <li>Scalpers and high-frequency traders monitoring connection quality</li> <li>Detecting network issues that might affect order execution</li> <li>Comparing latency across different times of day</li> </ul> <p><strong>Note:</strong> This feature is disabled by default as it's not critical for most trading styles. Enable it only if you're concerned about execution speed and network performance.</p> <h4>7.5 Daylight Saving Time Indicator</h4> <div class="code"> <p>InpShowDST = true (Default: true)</p> <p>Description: Show when Daylight Saving Time is active for major zones</p> </div> <p>Displays an indicator when DST (Daylight Saving Time) is currently active in major financial centers. This is important because session times can shift by one hour during DST transitions in March/April and October/November.</p> <p>Example: When British Summer Time is active, London is GMT+1 instead of GMT+0, which affects the actual clock time of the London session open/close relative to other time zones.</p> <h3>Part 8: Alert System</h3> <h4>8.1 Session Open Alerts</h4> <div class="code"> <p>InpAlertOnSession = false (Default: false)</p> <p>Description: Enable audio and visual alerts before session opens</p> </div> <p>When enabled, MarketTime will trigger an alert (sound and pop-up notification) before major trading sessions open, giving you advance warning to prepare for increased volatility and trading opportunities.</p> <h4>8.2 Alert Timing</h4> <div class="code"> <p>InpAlertMinutesBefore = 5 (Default: 5)</p> <p>Range: 1 to 60</p> <p>Description: How many minutes before session open to trigger the alert</p> </div> <p>This sets how much advance notice you receive. The default of 5 minutes gives you time to review your trading plan, check for news, and prepare orders before the session opens and volatility potentially increases.</p> <p><strong>Alert Configuration Examples:</strong></p> <div class="code"> <p>Conservative (More Preparation Time):</p> <p>InpAlertOnSession = true</p> <p>InpAlertMinutesBefore = 15</p> <p></p> <p>Standard (Quick Preparation):</p> <p>InpAlertOnSession = true</p> <p>InpAlertMinutesBefore = 5</p> <p></p> <p>Disabled (No Alerts):</p> <p>InpAlertOnSession = false</p> </div> <p><strong>Important:</strong> Alerts will trigger for each session that has countdown enabled (London, New York, Asia). If you have all three countdown enabled and alerts enabled, you'll receive three separate alerts per day. To reduce alert frequency, disable countdowns for sessions you don't actively trade.</p> <h3>Part 9: Configuration Examples for Different Trading Styles</h3> <h4>9.1 Scalper Configuration (M1-M5 Charts)</h4> <p>Scalpers need precise timing, high visibility of active sessions, and minimal historical zone clutter:</p> <div class="code"> <p>Panel Settings:</p> <p>InpPanelX = 20</p> <p>InpPanelY = 50</p> <p>InpStartCollapsed = false</p> <p></p> <p>Time Display:</p> <p>InpTimeFormat = TIME_FORMAT_24H</p> <p>InpShowSeconds = true (precise timing needed)</p> <p>InpShowLocalTime = true</p> <p>InpShowBrokerTime = true</p> <p>InpShowLondonTime = true</p> <p>InpShowNewYorkTime = true</p> <p>InpShowTokyoTime = false (disable if not trading Asian session)</p> <p></p> <p>Session Countdowns:</p> <p>InpShowLondonCountdown = true</p> <p>InpShowNYCountdown = true</p> <p>InpShowAsiaCountdown = false</p> <p></p> <p>Session Zones:</p> <p>InpDrawSessionZones = true</p> <p>InpDrawOverlapZone = true (critical for scalpers - highest liquidity)</p> <p>InpZoneTransparency = 90 (very subtle, won't interfere with price action)</p> <p>InpZoneDaysToShow = 2 (only recent zones, keep chart clean)</p> <p></p> <p>Additional Features:</p> <p>InpShowSpread = true (very important for scalpers)</p> <p>InpShowServerPing = true (monitor execution speed)</p> <p>InpAlertOnSession = true</p> <p>InpAlertMinutesBefore = 5</p> </div> <h4>9.2 Day Trader Configuration (M15-H1 Charts)</h4> <p>Day traders need balanced information with clear session visibility:</p> <div class="code"> <p>Panel Settings:</p> <p>InpPanelX = 20</p> <p>InpPanelY = 50</p> <p>InpStartCollapsed = false</p> <p></p> <p>Time Display:</p> <p>InpTimeFormat = TIME_FORMAT_24H</p> <p>InpShowSeconds = true</p> <p>InpShowLocalTime = true</p> <p>InpShowBrokerTime = true</p> <p>InpShowLondonTime = true</p> <p>InpShowNewYorkTime = true</p> <p>InpShowTokyoTime = true</p> <p></p> <p>Session Countdowns:</p> <p>InpShowLondonCountdown = true</p> <p>InpShowNYCountdown = true</p> <p>InpShowAsiaCountdown = true</p> <p></p> <p>Session Zones:</p> <p>InpDrawSessionZones = true</p> <p>InpDrawLondonZone = true</p> <p>InpDrawNewYorkZone = true</p> <p>InpDrawAsiaZone = true</p> <p>InpDrawOverlapZone = true</p> <p>InpZoneTransparency = 85 (default, good visibility)</p> <p>InpZoneDaysToShow = 5 (see full week of patterns)</p> <p></p> <p>Additional Features:</p> <p>InpShowSpread = true</p> <p>InpShowMarketStatus = true</p> <p>InpShowDayOfWeek = true</p> <p>InpAlertOnSession = true</p> <p>InpAlertMinutesBefore = 10</p> </div> <h4>9.3 Swing Trader Configuration (H4-D1 Charts)</h4> <p>Swing traders need less frequent updates and more historical context:</p> <div class="code"> <p>Panel Settings:</p> <p>InpPanelX = 20</p> <p>InpPanelY = 50</p> <p>InpStartCollapsed = true (start minimized, expand when needed)</p> <p></p> <p>Time Display:</p> <p>InpTimeFormat = TIME_FORMAT_24H</p> <p>InpShowSeconds = false (not critical for swing trading)</p> <p>InpShowLocalTime = true</p> <p>InpShowBrokerTime = true</p> <p>InpShowLondonTime = false</p> <p>InpShowNewYorkTime = false</p> <p>InpShowTokyoTime = false</p> <p></p> <p>Session Countdowns:</p> <p>InpShowLondonCountdown = false</p> <p>InpShowNYCountdown = false</p> <p>InpShowAsiaCountdown = false</p> <p></p> <p>Session Zones:</p> <p>InpDrawSessionZones = true</p> <p>InpDrawLondonZone = true</p> <p>InpDrawNewYorkZone = true</p> <p>InpDrawAsiaZone = false (less relevant for higher timeframes)</p> <p>InpDrawOverlapZone = true</p> <p>InpZoneTransparency = 80</p> <p>InpZoneDaysToShow = 15 (see multiple weeks)</p> <p></p> <p>Additional Features:</p> <p>InpShowSymbolInfo = true</p> <p>InpShowDayOfWeek = true</p> <p>InpShowMarketStatus = true</p> <p>InpShowSpread = false</p> <p>InpAlertOnSession = false</p> </div> <h4>9.4 Minimal Clean Chart Configuration</h4> <p>For traders who want time information but minimal visual elements:</p> <div class="code"> <p>Panel Settings:</p> <p>InpStartCollapsed = true (start collapsed)</p> <p></p> <p>Time Display:</p> <p>InpShowLocalTime = true</p> <p>InpShowBrokerTime = true</p> <p>InpShowLondonTime = false</p> <p>InpShowNewYorkTime = false</p> <p>InpShowTokyoTime = false</p> <p></p> <p>Session Countdowns:</p> <p>InpShowLondonCountdown = false</p> <p>InpShowNYCountdown = false</p> <p>InpShowAsiaCountdown = false</p> <p></p> <p>Session Zones:</p> <p>InpDrawSessionZones = false (no zones on chart)</p> <p></p> <p>Additional Features:</p> <p>InpShowSymbolInfo = true</p> <p>InpShowDayOfWeek = true</p> <p>All other features = false</p> </div> <h3>Part 10: Advanced Usage Tips and Best Practices</h3> <h4>10.1 Optimizing Panel Position</h4> <p><strong>For Multi-Monitor Setups:</strong> Position the panel in a consistent location across all chart windows so you can quickly reference time without searching for the panel.</p> <p><strong>For Single Monitor:</strong> Place the panel in a corner that doesn't interfere with price action viewing. Upper-left or upper-right corners work well for most traders.</p> <p><strong>Draggable Feature:</strong> Remember you can click and drag the panel after it loads. The InpPanelX and InpPanelY values are just starting positions.</p> <h4>10.2 Color Scheme Coordination</h4> <p>Match your MarketTime colors to your overall chart theme for a cohesive professional appearance:</p> <ul> <li>If you use blue candles, consider blue tones for the panel</li> <li>If you have a dark chart background, use lighter text colors for better readability</li> <li>Make session zone colors distinct from your indicator colors to avoid confusion</li> <li>Use the InpSessionActiveColor strategically - this color draws attention to active sessions</li> </ul> <h4>10.3 Session Time Customization Strategy</h4> <p>The default session times are standard, but you can customize them based on your trading approach:</p> <p><strong>For News Traders:</strong> Set session opens to coincide with major news release times (e.g., 8:30 AM EST for US news).</p> <p><strong>For Liquidity Hunters:</strong> Focus on the London-New York overlap (13:30-16:30 GMT) by adjusting zone times to highlight this specific period more prominently.</p> <p><strong>For Asian Market Specialists:</strong> Extend Asia session times to cover Sydney open through Tokyo close (23:00 GMT to 10:00 GMT).</p> <h4>10.4 Multiple Chart Instances</h4> <p>You can have different MarketTime configurations on different charts:</p> <ul> <li><strong>Chart 1 (Primary):</strong> Full panel with all features enabled</li> <li><strong>Chart 2-4:</strong> Collapsed panels (InpStartCollapsed = true) showing only session zones</li> <li><strong>Analysis Chart:</strong> No panel, only session zones for visual context</li> </ul> <p>Each chart's MarketTime instance is independent, so customize each one for its specific purpose.</p> <h4>10.5 Session Zone Interpretation</h4> <p>Use session zones to identify patterns in price behavior:</p> <ul> <li><strong>Breakouts:</strong> Often occur at session opens when fresh liquidity enters</li> <li><strong>Reversals:</strong> Watch for exhaustion near session closes</li> <li><strong>Range Trading:</strong> Asia session often shows ranging behavior for certain pairs</li> <li><strong>Trend Continuation:</strong> London and New York sessions often see directional moves</li> <li><strong>Overlap Periods:</strong> Highest volume, best for momentum strategies</li> </ul> <h4>10.6 Spread Monitoring for Entry Timing</h4> <p>If you have InpShowSpread enabled, watch for:</p> <ul> <li><strong>Spread spikes during news:</strong> Avoid entries during abnormally high spreads</li> <li><strong>Lower spreads during overlaps:</strong> Optimal entry times for cost-conscious traders</li> <li><strong>Weekend spread widening:</strong> Be aware spreads widen significantly on Friday close and Sunday open</li> </ul> <h4>10.7 Alert System Strategy</h4> <p>Configure alerts based on your availability and strategy:</p> <p><strong>Full-Time Traders:</strong> Use 5-10 minute alerts for session opens you actively trade.</p> <p><strong>Part-Time Traders:</strong> Set longer alerts (15-30 minutes) to give yourself time to reach your trading station.</p> <p><strong>Multiple Session Traders:</strong> Enable alerts for all three sessions.</p> <p><strong>Specialized Traders:</strong> Only enable alerts for your specific session (e.g., only London if you're a European morning trader).</p> <h4>10.8 Performance Optimization</h4> <p>If you notice any performance issues (rare, but possible on very low-end systems or very fast charts):</p> <ul> <li>Reduce InpZoneDaysToShow (fewer zones = less drawing)</li> <li>Disable InpShowSeconds (fewer panel updates)</li> <li>Disable InpShowServerPing (eliminates network checks)</li> <li>Use TIME_FORMAT_24H instead of 12H (slightly less formatting)</li> <li>Set InpStartCollapsed = true to minimize panel updates when you don't need them</li> </ul> <h3>Part 11: Troubleshooting and Common Questions</h3> <h4>11.1 Panel Not Visible</h4> <p><strong>Issue:</strong> After attaching indicator, panel doesn't appear on chart.</p> <p><strong>Solutions:</strong></p> <ul> <li>Check if InpPanelX and InpPanelY values are beyond your screen resolution - try resetting to 20 and 50</li> <li>Make sure you're looking at the correct chart window where you attached the indicator</li> <li>Try removing the indicator and re-attaching it</li> <li>Check if the panel is collapsed (look for a small header at the position) - click to expand</li> </ul> <h4>11.2 Session Times Don't Match My Broker</h4> <p><strong>Issue:</strong> Session zones appear at different times than expected.</p> <p><strong>Explanation:</strong> All session times are configured in GMT, but the zones are drawn in your broker's server time. Your broker might be GMT+2, GMT+3, or a different offset.</p> <p><strong>Solution:</strong> The zones ARE correct for your broker - they're automatically converted. If you want to verify, check what time it is in GMT when a session opens, and confirm that matches your configured InpLondonOpenHour, etc.</p> <h4>11.3 Colors Don't Match My Preferences</h4> <p><strong>Issue:</strong> Default colors don't work with my chart theme.</p> <p><strong>Solution:</strong> All colors are fully customizable. See Part 2.2 for color customization options. Use C'R,G,B' format where R, G, B are values 0-255.</p> <h4>11.4 Too Much Information Displayed</h4> <p><strong>Issue:</strong> Panel is too large/cluttered with information I don't need.</p> <p><strong>Solution:</strong> Every display element can be disabled independently. Review Parts 3-7 and set any Inp...Show... parameter to false to hide that information. For example, set InpShowTokyoTime = false if you don't trade Asian sessions.</p> <h4>11.5 Session Zones Overlap and Create Confusing Colors</h4> <p><strong>Issue:</strong> When multiple session zones overlap, colors blend in confusing ways.</p> <p><strong>Solution:</strong> Either increase InpZoneTransparency to make zones more subtle (90-95), or disable individual zones you don't need. Alternatively, disable InpDrawOverlapZone and rely on seeing the individual session zones side by side.</p> <h4>11.6 Alerts Not Triggering</h4> <p><strong>Issue:</strong> InpAlertOnSession is enabled but no alerts appear.</p> <p><strong>Solutions:</strong></p> <ul> <li>Make sure at least one session countdown is enabled (InpShowLondonCountdown, InpShowNYCountdown, or InpShowAsiaCountdown)</li> <li>Check MetaTrader alert settings - ensure alerts are not disabled globally</li> <li>Verify the session open time hasn't already passed for today</li> <li>Alerts trigger InpAlertMinutesBefore the session opens, not at the exact open time</li> </ul> <h4>11.7 Custom Timezone Not Displaying Correctly</h4> <p><strong>Issue:</strong> Custom timezone shows wrong time.</p> <p><strong>Solution:</strong> Verify you selected the correct TZ_UTC_... value. Remember that TZ_UTC_P530 is UTC+5:30 (India), and TZ_UTC_P930 is UTC+9:30 (Australia) - these special half-hour zones use different enum values.</p> <h4>11.8 Symbol Shows Always Closed</h4> <p><strong>Issue:</strong> Symbol status shows CLOSED even during trading hours.</p> <p><strong>Possible Causes:</strong></p> <ul> <li>Symbol genuinely has restricted trading hours (check with your broker)</li> <li>Symbol may be suspended or delisted</li> <li>Your account may not have permission to trade this symbol</li> <li>Broker may have specific maintenance schedules</li> </ul> <p><strong>Solution:</strong> Verify the symbol's trading schedule with your broker. The indicator displays information provided by the broker server - it doesn't create or modify this data.</p> <h3>Conclusion: Getting the Most from MarketTime</h3> <p>MarketTime is designed to be your comprehensive time and session awareness tool for MetaTrader 5. By displaying multiple time zones, providing live session countdowns, showing symbol trading hours, and drawing visual session zones on your charts, it eliminates the need for external tools and gives you all time-critical information at a glance.</p> <p><strong>Key Benefits Recap:</strong></p> <ul> <li><strong>Multi-timezone awareness:</strong> Never miss a trading opportunity because you didn't know what time it was in London, New York, or Tokyo</li> <li><strong>Session timing precision:</strong> Live countdowns tell you exactly when sessions open, close, and overlap</li> <li><strong>Visual session zones:</strong> Instantly identify which session drove any price movement on your chart</li> <li><strong>Symbol status monitoring:</strong> Know whether your symbol is tradable right now, and when it opens next</li> <li><strong>Fully customizable:</strong> Every color, font, position, and displayed element can be tailored to your preferences</li> <li><strong>Performance optimized:</strong> Lightweight code that won't slow down your charts</li> <li><strong>Professional presentation:</strong> Clean, modern interface that looks professional on any chart</li> </ul> <p>Whether you're a scalper who needs split-second timing awareness, a day trader planning around session opens, or a swing trader monitoring weekly market cycles, MarketTime provides the temporal context you need to trade confidently and effectively.</p> <p><strong>Recommended Starting Point:</strong> Use the default settings initially to get familiar with all features, then customize based on your trading style using the configuration examples in Part 9. Most traders find the "Day Trader Configuration" works well as a balanced starting point, then adjust from there.</p> <p><strong>Remember:</strong> The indicator is fully interactive - you can always drag the panel to reposition it, click to collapse/expand it, and adjust any settings by opening the indicator properties (right-click on chart → Indicators List → MarketTime → Properties).</p> <h3>Need Help?</h3> <p>If you have questions, suggestions, or need assistance with MarketTime, please join our MQL5 community group where you can connect with other users, share configurations, and get support:</p> <p><strong>MQL5 Community Group:</strong> <a href="/en/messages/012b44120193dc01">Join Here</a></p> <p>You can also contact me directly through MQL5 messaging for technical support or feature requests:</p> <p><strong>Direct Support:</strong> <a href="/en/users/scalptime">Contact via MQL5</a></p> <p>For more professional trading tools and indicators, check out my other products:</p> <p><strong>More Products:</strong> <a href="/en/users/scalptime/seller">View All Products</a></p> <h3>Disclaimer</h3> <p>MarketTime is an informational tool that displays time and session data. It does not provide trading signals, strategy recommendations, or investment advice. All trading decisions remain your responsibility. Past performance does not guarantee future results. Trading forex and CFDs carries significant risk of loss and may not be suitable for all investors. Please ensure you understand the risks involved and seek independent financial advice if necessary.</p> <p>The accuracy of time displays, session information, and symbol trading hours depends on data provided by your broker's server. While MarketTime processes and displays this information accurately, the underlying data quality is determined by your broker. Always verify critical timing information with your broker when necessary.</p> <p>Session zone drawing is a visual aid for identifying market sessions and does not constitute a trading strategy or guarantee of profitability. The indicator does not predict price movements or guarantee trading success.</p>
        </div>
        <div class="attach">
        </div>
      </div>
          <div class="commands">
            <div style="float: left;">
            </div>
            <div style="clear: both"></div>
          </div>
    </div>
        <div class="commentsBox">
          <div style="margin: 8px 0; text-align: right">
            <span style="font-weight: bold;">To add comments, please <a href="https://www.mql5.com/en/auth_login">log in</a> or <a href="https://www.mql5.com/en/auth_register">register</a></span>
          </div>
        </div>
        <div class="twoColumns limited" >
          

    <div class="blogPostItem short">
      <div class="container">
        <div class="avatar"><img src="https://c.mql5.com/avatar/2026/5/6a0878bc-2b0d.png" alt="" loading="lazy" width="60" height="60"></div>
        <h2><a href="/en/blogs/post/772198">Swing Trading vs Scalping</a></h2>

          <div class="blogPostInfo">
            <a class="category" href="/en/blogs/trading/strategies">Trading Strategies</a>
            <ul class="info">
              <li title="Views"><i class="icon views"></i>19</li>
              <li title="Comments"><i class="icon comments"></i>0</li>
            </ul>
          </div>
      </div>
    </div>
    <div class="blogPostItem short">
      <div class="container">
        <div class="avatar"><img src="https://c.mql5.com/avatar/2026/5/6a0878bc-2b0d.png" alt="" loading="lazy" width="60" height="60"></div>
        <h2><a href="/en/blogs/post/772197">Carry Trade Explained: Profiting From Interest Rate Differentials</a></h2>

          <div class="blogPostInfo">
            <a class="category" href="/en/blogs/trading/strategies">Trading Strategies</a>
            <ul class="info">
              <li title="Views"><i class="icon views"></i>36</li>
              <li title="Comments"><i class="icon comments"></i>0</li>
            </ul>
          </div>
      </div>
    </div>
    <div class="blogPostItem short">
      <div class="container">
        <div class="avatar"><img src="https://c.mql5.com/avatar/2026/5/69fcf6cf-b51c.png" alt="" loading="lazy" width="60" height="60"></div>
        <h2><a href="/en/blogs/post/772190">QB Compass Signal Pro is an advanced predictive market direction indicator for MetaTrader 4.</a></h2>

          <div class="blogPostInfo">
            <a class="category" href="/en/blogs/trading/strategies">Trading Strategies</a>
            <ul class="info">
              <li title="Views"><i class="icon views"></i>34</li>
              <li title="Comments"><i class="icon comments"></i>0</li>
            </ul>
          </div>
      </div>
    </div>
    <div class="blogPostItem short">
      <div class="container">
        <div class="avatar"><img src="https://c.mql5.com/avatar/2025/8/68ab422c-aa20.jpg" alt="" loading="lazy" width="60" height="60"></div>
        <h2><a href="/en/blogs/post/772011">MSX AI Multi Symbol Scalper — ATR-Based Stop Loss, Take Profit, Partial Close &amp; Trade Lifecycle Management Explained</a></h2>

          <div class="blogPostInfo">
            <a class="category" href="/en/blogs/trading/strategies">Trading Strategies</a>
            <ul class="info">
              <li title="Views"><i class="icon views"></i>28</li>
              <li title="Comments"><i class="icon comments"></i>0</li>
            </ul>
          </div>
      </div>
    </div>
    <div class="blogPostItem short">
      <div class="container">
        <div class="avatar"><img src="https://c.mql5.com/avatar/2026/4/69f226e3-e428.png" alt="" loading="lazy" width="60" height="60"></div>
        <h2><a href="/en/blogs/post/772164">Why More Gold Traders Are Blowing Their Accounts in 2026 - And It Has Less to Do with Their Entries Than They Think</a></h2>

          <div class="blogPostInfo">
            <a class="category" href="/en/blogs/trading/strategies">Trading Strategies</a>
            <ul class="info">
              <li title="Views"><i class="icon views"></i>43</li>
              <li title="Comments"><i class="icon comments"></i>0</li>
                <li title="Like"><i class="icon likes"></i>1</li>
            </ul>
          </div>
      </div>
    </div>
    <div class="blogPostItem short">
      <div class="container">
        <div class="avatar"><img src="https://c.mql5.com/avatar/2021/10/61649468-31AE.jpg" alt="" loading="lazy" width="60" height="60"></div>
        <h2><a href="/en/blogs/post/772160">Trading Without Magic: A Developer’s And Trader’s Honest View On “Holy Grails” And Reality</a></h2>

          <div class="blogPostInfo">
            <a class="category" href="/en/blogs/trading/strategies">Trading Strategies</a>
            <ul class="info">
              <li title="Views"><i class="icon views"></i>65</li>
              <li title="Comments"><i class="icon comments"></i>0</li>
            </ul>
          </div>
      </div>
    </div>
    <div class="blogPostItem short">
      <div class="container">
        <div class="avatar"><img src="https://c.mql5.com/avatar/2025/6/684d7264-ffd2.png" alt="" loading="lazy" width="60" height="60"></div>
        <h2><a href="/en/blogs/post/772147">18 Years of Monthly Results</a></h2>

          <div class="blogPostInfo">
            <a class="category" href="/en/blogs/trading/statistics">Statistics</a>
            <ul class="info">
              <li title="Views"><i class="icon views"></i>41</li>
              <li title="Comments"><i class="icon comments"></i>0</li>
                <li title="Like"><i class="icon likes"></i>1</li>
            </ul>
          </div>
      </div>
    </div>
    <div class="blogPostItem short">
      <div class="container">
        <div class="avatar"><img src="https://c.mql5.com/avatar/2026/7/6a46f1da-d5aa.png" alt="" loading="lazy" width="60" height="60"></div>
        <h2><a href="/en/blogs/post/772142">The Win Rate Myth: Why the Metric Every Trader Obsesses Over   Tells You Almost Nothing About a System&#39;s Real Performanc</a></h2>

          <div class="blogPostInfo">
            <a class="category" href="/en/blogs/trading/strategies">Trading Strategies</a>
            <ul class="info">
              <li title="Views"><i class="icon views"></i>51</li>
              <li title="Comments"><i class="icon comments"></i>0</li>
            </ul>
          </div>
      </div>
    </div>
    <div class="blogPostItem short">
      <div class="container">
        <div class="avatar"><img src="https://c.mql5.com/avatar/2024/5/663b6b65-89b1.png" alt="" loading="lazy" width="60" height="60"></div>
        <h2><a href="/en/blogs/post/772141">AI GOLD ONI - Nearly 3 Months of Live Signal Results - 2000 USD PROFIT</a></h2>

          <div class="blogPostInfo">
            <a class="category" href="/en/blogs/trading/statistics">Statistics</a>
            <ul class="info">
              <li title="Views"><i class="icon views"></i>39</li>
              <li title="Comments"><i class="icon comments"></i>0</li>
            </ul>
          </div>
      </div>
    </div>

        </div>
    <div style="height: 1px; overflow: hidden; clear: both;"></div>
  </div>    <div class="column right">
      
  <ul class="thumbs">
      <li>
        <a href="/en/blogs/post/772143" class="image">
            <i class="views" title="Views">93</i>
            <img src="https://c.mql5.com/6/1014/splash-preview-772143.png" alt="The Complete Guide to Algorithmic Trading in 2026: Why AI Expert Advisors Are Transforming Modern Trading" title="The Complete Guide to Algorithmic Trading in 2026: Why AI Expert Advisors Are Transforming Modern Trading" loading="lazy" width="280" height="180"/><br />
          The Complete Guide to Algorithmic Trading in 2026: Why AI Expert Advisors Are Transforming Modern Trading
        </a>
      </li>
      <li>
        <a href="/en/blogs/post/772193" class="image">
            <i class="views" title="Views">37</i>
            <img src="https://c.mql5.com/6/1015/splash-preview-772193-1783031694.png" alt="The Future of Expert Advisors: How AI Will Transform Financial Trading by 2030" title="The Future of Expert Advisors: How AI Will Transform Financial Trading by 2030" loading="lazy" width="280" height="180"/><br />
          The Future of Expert Advisors: How AI Will Transform Financial Trading by 2030
        </a>
      </li>
      <li>
        <a href="/en/blogs/post/772146" class="image">
            <i class="views" title="Views">77</i>
            <img src="https://c.mql5.com/6/1014/splash-preview-772146.jpg" alt="Fundamental Market Analysis for July 1, 2026 (EURUSD, GBPUSD, USDJPY)" title="Fundamental Market Analysis for July 1, 2026 (EURUSD, GBPUSD, USDJPY)" loading="lazy" width="280" height="180"/><br />
          Fundamental Market Analysis for July 1, 2026 (EURUSD, GBPUSD, USDJPY)
        </a>
      </li>
  </ul>

  <ul class="tags">
      <li><a href="/en/blogs/tags/forex">forex</a></li>
      <li><a href="/en/blogs/tags/technicalanalysis">technical analysis</a></li>
      <li><a href="/en/blogs/tags/175">eurusd</a></li>
      <li><a href="/en/blogs/tags/eurusd">EUR/USD</a></li>
      <li><a href="/en/blogs/tags/176">gbpusd</a></li>
      <li><a href="/en/blogs/tags/gold">gold</a></li>
      <li><a href="/en/blogs/tags/179">usdjpy</a></li>
      <li><a href="/en/blogs/tags/gbpusd">GBP/USD</a></li>
      <li><a href="/en/blogs/tags/usdjpy">usd/jpy</a></li>
      <li><a href="/en/blogs/tags/1860">usd</a></li>
      <li><a href="/en/blogs/tags/trading">Trading</a></li>
      <li><a href="/en/blogs/tags/584">AUD/USD</a></li>
      <li><a href="/en/blogs/tags/230">usd/chf</a></li>
      <li><a href="/en/blogs/tags/sp500">S&amp;P 500</a></li>
      <li><a href="/en/blogs/tags/202">forecast</a></li>
      <li><a href="/en/blogs/tags/usdcad">usd/cad</a></li>
      <li><a href="/en/blogs/tags/fed">Fed</a></li>
      <li><a href="/en/blogs/tags/bitcoin">bitcoin</a></li>
      <li><a href="/en/blogs/tags/21425">Fxwirepro</a></li>
      <li><a href="/en/blogs/tags/dax">dax</a></li>
      <li><a href="/en/blogs/tags/fundamentalanalysis">fundamental analysis</a></li>
      <li><a href="/en/blogs/tags/16445">VistaBrokers</a></li>
      <li><a href="/en/blogs/tags/40965">Gold spot ($)</a></li>
      <li><a href="/en/blogs/tags/40966">Silver spot ($)</a></li>
      <li><a href="/en/blogs/tags/40958">Crude Oil (WTI)</a></li>
      <li><a href="/en/blogs/tags/14730">USD/TRY</a></li>
      <li><a href="/en/blogs/tags/177">audusd</a></li>
      <li><a href="/en/blogs/tags/4796">EUR</a></li>
      <li><a href="/en/blogs/tags/forexnews">forex news</a></li>
      <li><a href="/en/blogs/tags/ecb">ECB</a></li>
  </ul>

    </div>
</div>

    </article>
  </main>

    <footer aria-hidden="true">


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


    </footer>

  <div class="shadow-layer" id="layer"></div>
      
</div>


    
<script type="text/javascript">
           mqGlobal.AddOnReady(function () { Mql5Cookie.init('mql5.com','5045851794452967924'); });
mqGlobal.AddOnReady(function(){if(!window.likes){window.likes=new Likes();}});mqGlobal.AddOnReady(function(){{window.initHeaderSearch('','https://www.mql5.com/en/search');}});</script><script type="text/javascript">mqGlobal.AddOnReady(function(){window.initSuggestions("headerSearchKeyword","en","https://search.mql5.com/api/query","https://www.mql5.com/en/users_search/suggestion");});window.fz("show","bfogggabsofabcpxuzmgaibarmaxasdrj");function complaintInline(itemId,moduleId,typeId,parentModuleId){if(!window.showComplaintForm)return false;return showComplaintForm(itemId,moduleId,typeId,parentModuleId,'0c24384c6e7464b41660d4ed0235d573');};mqGlobal.AddOnReady(function(){window.floatVerticalPanelNode=FloatVerticalPanel('This website uses cookies. Learn more about our <a href="/en/about/cookies">Cookies Policy</a>.','cookie_accept');});mqGlobal.AddOnReady(function(){window.initAddCopyButtonsToCodes('Copy to Clipboard');});      if (typeof Attach !== "undefined")
        Attach.setAcceptFilter(".zip, .txt, .log, .mqh, .ex5, .mq5, .mq4, .mqproj, .ex4, .mt5, .set, .tpl, .cl, .py, .sqlite, .csv, .ini, .ipynb, .onnx, .gif, .png, .jpg, .jpeg, .webp, .mp4, .webm");
  </script>

  <div class="b-fixed-mt" id="bFixedMt" style="display: none;">
    
  </div>

  <script type="application/ld&#x2B;json">
  [{"@context":"https://schema.org","@type":"ItemList","itemListElement":[{"@type":"SiteNavigationElement","position":1,"name":"Forum","description":"Discussions of trading strategies and algorithmic trading. MQL5.community  the largest forex forum","url":"https://www.mql5.com/en/forum","children":[]},{"@type":"SiteNavigationElement","position":2,"name":"Market","description":"MetaTrader Market - a Market of trading robots, indicators, trading books and magazines","url":"https://www.mql5.com/en/market","children":[]},{"@type":"SiteNavigationElement","position":3,"name":"Signals","description":"Social trading, copy trading and account monitoring with MetaTrader - Trading Signals on MQL5.com","url":"https://www.mql5.com/en/signals","children":[]},{"@type":"SiteNavigationElement","position":4,"name":"Freelance","description":"Order trading robots, technical indicators and algorithmic trading applications. Forex jobs. Freelance on MQL5.com. Hire MetaTrader experts and specialists","url":"https://www.mql5.com/en/job","children":[]},{"@type":"SiteNavigationElement","position":5,"name":"Quotes","description":"","url":"https://www.mql5.com/en/quotes/overview","children":[]},{"@type":"SiteNavigationElement","position":6,"name":"MetaTrader","description":"","url":"https://www.metatrader.com","children":[]},{"@type":"SiteNavigationElement","position":7,"name":"WebTerminal","description":"WebTerminal for the MetaTrader trading platform. Online forex trading.","url":"https://web.metatrader.app/terminal?mode=demo","children":[]},{"@type":"SiteNavigationElement","position":8,"name":"Calendar","description":"","url":"https://www.mql5.com/en/economic-calendar","children":[]},{"@type":"SiteNavigationElement","position":9,"name":"VPS","description":"","url":"https://www.mql5.com/en/vps","children":[]},{"@type":"SiteNavigationElement","position":10,"name":"Articles","description":"","url":"https://www.mql5.com/en/articles","children":[]},{"@type":"SiteNavigationElement","position":11,"name":"CodeBase","description":"Download trading robots, technical indicators and scripts with source code - MQL5 Code Base for MetaTrader 5","url":"https://www.mql5.com/en/code","children":[]},{"@type":"SiteNavigationElement","position":12,"name":"Algo Forge","description":"","url":"https://forge.mql5.io","children":[]},{"@type":"SiteNavigationElement","position":13,"name":"Documentation","description":"MetaQuotes Language 5 (MQL5) Reference - Documentation on MQL5.com","url":"https://www.mql5.com/en/docs","children":[]}]}  
,
{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"item":"https://www.mql5.com/en/blogs","name":"All Blogs"},{"@type":"ListItem","position":2,"item":"https://www.mql5.com/en/blogs/trading","name":"My Trading"},{"@type":"ListItem","position":3,"item":"https://www.mql5.com/en/blogs/trading/strategies","name":"Trading Strategies"}]}
,
{"@context":"https://schema.org","@type":"BlogPosting","mainEntityOfPage":{"@type":"WebPage","@id":"https://www.mql5.com/en/blogs/post/767099"},"thumbnailUrl":"https://c.mql5.com/avatar/2026/2/698d0a1d-45bd.jpg","headline":"MarketTime v1.10: Professional Multi-Timezone Clock & Session Indicator - Complete Documentation","articleSection":"Trading Strategies","keywords":[],"image":{"@type":"ImageObject","url":"https://c.mql5.com/avatar/2026/2/698d0a1d-45bd.jpg","width":60,"height":60},"datePublished":"2026-02-01T00:29:10","dateModified":"2026-02-01T00:29:10","author":{"@type":"Person","name":"Kaan Caliskan","url":"https://www.mql5.com/en/users/scalptime"},"publisher":{"@type":"Organization","name":"Kaan Caliskan","url":"https://kaancaliskan.com","logo":{"@type":"ImageObject","url":"https://c.mql5.com/avatar/2026/2/698d0a1d-45bd.jpg"}}}

  ]
</script>
</body>
</html>
