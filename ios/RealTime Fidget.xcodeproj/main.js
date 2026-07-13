console.log("✅ main.js has been loaded and is running");
alert("main.js is running!");
// ==UserScript==
// @name         Reddit - remove sponsored posts and comments
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Remove sponsored posts and comments from Reddit
// @author       You
// @match        https://www.reddit.com/*
// @icon         https://www.redditstatic.com/desktop2x/img/favicon/favicon-32x32.png
// @grant        none
// ==/UserScript==

(function() {
  'use strict';

  // Your code here...
  console.log("Script started");

  const removeSponsored = () => {
    const sponsoredPosts = document.querySelectorAll('div[data-testid="post-container"] span:contains("Promoted")');
    sponsoredPosts.forEach(post => {
      let postContainer = post.closest('div[data-testid="post-container"]');
      if (postContainer) {
        postContainer.remove();
      }
    });

    // Remove sponsored comments
    const sponsoredComments = document.querySelectorAll('div[id^="t1_"] span:contains("Promoted")');
    sponsoredComments.forEach(comment => {
      let commentContainer = comment.closest('div[id^="t1_"]');
      if (commentContainer) {
        commentContainer.remove();
      }
    });
  };

  setInterval(removeSponsored, 2000);

})();
