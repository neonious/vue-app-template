"use strict";

/*
 * This is the only code which runs on the client outside of a module
 */

async function main() {
    const FETCH_TIMEOUT_MS = 30000;

    let loadedModules = {}, loadedModulesAsync = {}, loadedComponents = {};
    let connectionErrorCount = 0;

    function connectionError(inc) {
        if(inc) {
            if(!connectionErrorCount++)
                document.getElementById('overlayNoConnection').style.display = '';
        } else {
            if(!--connectionErrorCount) {
                document.getElementById('overlayNoConnection').style.display = 'none';
            }
        }
    }

    function serverFetchSync(url, options) {
        let isStatus = true;
        function status(isStatusNow) {
            if(!isStatus && isStatusNow)
                connectionError(false);
            else if(isStatus && !isStatusNow)
                connectionError(true);
            isStatus = isStatusNow;
        }

        while(true) {
            try {
                let request = new XMLHttpRequest();
                request.open('POST', url, false);
                request.send(null);

                if(request.status >= 200 && request.status < 300) {
                    status(true);
                    return request.responseText;
                } else if(request.status == 404) {
                    if(options && options.fileNotFoundOK)
                        status(true);
                    else {
                        document.getElementById('overlayFileNotFound').style.display = '';
                        throw new Error(url + ' not found');
                    }
                    return;
                } else if(request.status) {
                    panic('syncronous fetch of ' + url + ' returned status code ' + request.status);
                    return;
                }
            } catch(e) {
                console.error(e);
            }
            status(false);
        }
    }

    function serverFetchAsync(url, options) {
        let isStatus = true;
        function status(isStatusNow) {
            if(!isStatus && isStatusNow)
                connectionError(false);
            else if(isStatus && !isStatusNow)
                connectionError(true);
            isStatus = isStatusNow;
        }

        return new Promise((resolve, reject) => {
            function loop1() {
                let done = false;

                let request = new XMLHttpRequest();
                request.timeout = FETCH_TIMEOUT_MS;

                request.onload = () => {
                    if(done)
                        return;
                    done = true;

                    if(request.status >= 200 && request.status < 300) {
                        status(true);
                        resolve(request.responseText);
                    } else if(request.status == 404) {
                        if(options && options.fileNotFoundOK) {
                            status(true);
                            resolve();
                        } else {
                            console.error(url + ' not found');
                            document.getElementById('overlayFileNotFound').style.display = '';
                        }
                    } else if(request.status)
                        panic('asyncronous fetch of ' + url + ' returned status code ' + request.status);
                    else {
                        status(false);
                        setTimeout(loop1, 1000);
                    }
                };
                request.onerror = () => {
                    if(done)
                        return;
                    done = true;

                    status(false);
                    setTimeout(loop1, 1000);
                };
                request.ontimeout = () => {
                    if(done)
                        return;
                    done = true;

                    status(false);
                    loop1();
                };

                request.open('POST', url, true);
                request.send();
            }
            loop1();
        });
    }

    function pathJoin(baseFile, file) {
        let part1 = baseFile.split('/');
        part1.pop();
        let parts = part1.concat(file.split('/'));

        let newParts = [parts[0]];
        for(let i = 1; i < parts.length; i++) {
            let part = parts[i];
            if(!part || part == '.')
                continue;

            if(part == '..')
                newParts.pop();
            else
                newParts.push(part);
        }

        return newParts.join('/');
    }

    function loadModule(path, code) {
        let pos = path.lastIndexOf('/');
        code = new Function('exports', 'require', 'module', '__filename', '__dirname', code);

        let module = {exports: {}};
        code(module.exports, (module) => {
            return requireAbsoluteSync(module[0] == '.' ? pathJoin(path, module) : module);
        }, module, path.substr(pos + 1), pos == -1 ? '' : path.substr(0, pos));

        loadedModules[path] = module.exports;
        return module.exports;
    }

    function requireAbsoluteSync(origPath) {
        let path;
        if(origPath[0] == '/')
            path = origPath + '.js';
        else
            path = '/lib/' + origPath + '.js';
        if(loadedModules[path])
            return loadedModules[path];

        console.warn('Fetching ' + path + ' in blocking mode as not loaded yet. Please use await require(\'[...]/main/lib\').requireAsync(\'' + origPath + '\') instead of require');

        let request = serverFetchSync(path);
        return loadModule(path, request);
    }

    async function requireAbsoluteAsync(path) {
        if(path[0] == '/')
            path += '.js';
        else
            path = '/lib/' + path + '.js';
        if(loadedModules[path])
            return loadedModules[path];

        let loadedPromise = loadedModulesAsync[path];
        if(!loadedPromise)
            loadedPromise = loadedModulesAsync[path] = async function() {
                let response = await serverFetchAsync(path);
                return loadModule(path, response);
            }();
        return await loadedPromise;
    }

    async function loadComponent(name) {
        let loadedPromise = loadedComponents[name];
        if(!loadedPromise)
            loadedPromise = loadedComponents[name] = async function() {
                let elems = [
                    requireAbsoluteAsync('/components/' + name + '/code'),
                    serverFetchAsync('/components/' + name + '/template.html')
                ];
                if(!loadedComponentStyles[name])
                    elems.push(serverFetchAsync('/components/' + name + '/style.css', {fileNotFoundOK: true}));
                elems = await Promise.all(elems);

                let code = elems[0];
                if(!code.component.template) {
                    let template = elems[1];
                    code.component.template = '<div id="' + name + '">' + template + '</div>';
                }

                if(!loadedComponentStyles[name]) {
                    let style = elems[2];
                    if(style) {
                        let node = document.createElement('style');
                        node.innerHTML = style;
                        document.head.appendChild(node);
                    }
                }

                return code.component;
            }();
        return await loadedPromise;
    }

    function panic(err) {
        document.getElementById('overlayPanic').style.display = '';
        throw new Error(err);
    }

    try {
        // Preload all libraries in parallel
        let libsPromises = [requireAbsoluteAsync('/main/lib')];
        for(let i = 0; i < libs.length; i++)
            libsPromises.push(requireAbsoluteAsync(libs[i]));
        libsPromises = await Promise.all(libsPromises);

        // Setup lib
        let lib = libsPromises[0];

        lib.requireAsync = requireAbsoluteSync;
        lib.panic = panic;

        // Register all components other than app for lazy load
        const Vue = requireAbsoluteSync('vue');

        for(let i = 0; i < components.length; i++) {
            Vue.component(components[i], (resolve, reject) => {
                loadComponent(components[i]).then(resolve).catch(reject);
            });
        }

        let app = new Vue(await loadComponent('app'));
        // Hydrate from server
        app.$mount('#app', true);
    } catch(err) {
        panic(err);
    }
}
main();