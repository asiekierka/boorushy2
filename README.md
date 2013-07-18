# Boorushy<sup>2</sup>

Boorushy<sup>2</sup> is an image gallery/booru engine designed by asiekierka, aiming for a simple UI without the 
plague of hundreds of features that current engines have.

## Features

* Simple user interface focusing on the content (images) and not the buttons
* Custom, fast Redis-based database with caching - fast!
* Asynchronous file/URL upload UI with automatic DeviantART data fill
* A full-featured tag search engine
* Tag and author clouds
* Built-in social button functionality that respects your freedom
* Configurable and styleable as much as you want

## Installation

3. Install the dependencies: <b>node.js</b> and <b>Redis</b>. (Tested with node.js 0.8.x, 0.10.x and Redis 2.6.x. YMMV)
1. Download the Boorushy<sup>2</sup> repository.
3. Create the <b>config.json</b> file and edit it based on config-default.json. Don't forget to:
	* <b>SET A REASONABLY RANDOM SALT</b> - otherwise the server won't start up.
	* Change the port to 80 (if you want)
	* Change the admin password.
3. Install all the necessary dependencies:

		$ npm install

7. Double-check that the Redis database server is running, then launch Boorushy<sup>2</sup>:

		$ node app
