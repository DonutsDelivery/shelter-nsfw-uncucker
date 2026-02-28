({
    onLoad() {
        const {
            flux: { intercept, storesFlat: { UserStore } },
            http,
        } = shelter;

        const EXPLICIT_FLAG = 16;
        const LOG = "[NSFW Uncucker]";
        const MESSAGE_URL_RE = /\/api\/v\d+\/channels\/\d+\/messages/;

        function stripExplicitFlags(attachments) {
            if (!Array.isArray(attachments)) return false;
            let modified = false;
            for (const att of attachments) {
                if (att && typeof att.flags === "number" && (att.flags & EXPLICIT_FLAG)) {
                    att.flags &= ~EXPLICIT_FLAG;
                    modified = true;
                }
            }
            return modified;
        }

        function patchMessage(msg) {
            if (!msg || typeof msg !== "object") return false;
            return stripExplicitFlags(msg.attachments);
        }

        const SPOILER_STRIP = ["opaque_", "hidden_", "constrainedObscureContent_"];
        const IMAGE_STRIP = ["obscured_", "hiddenExplicit_", "hiddenMosaicItem_"];

        function stripClasses(el, prefixes) {
            let stripped = false;
            for (const cls of [...el.classList]) {
                if (prefixes.some(function(p) { return cls.startsWith(p); })) {
                    el.classList.remove(cls);
                    stripped = true;
                }
            }
            return stripped;
        }

        function sweepDOM(root) {
            if (!root) return;
            root.querySelectorAll('[class*="explicitContentWarning"], [class*="obscureWarning"]').forEach(function(el) {
                el.style.display = "none";
            });
            root.querySelectorAll('[class*="spoilerContent"]').forEach(function(el) {
                stripClasses(el, SPOILER_STRIP);
            });
            root.querySelectorAll('[class*="obscured_"], [class*="hiddenExplicit_"], [class*="hiddenMosaicItem_"]').forEach(function(el) {
                stripClasses(el, IMAGE_STRIP);
            });
        }

        // Layer 1: HTTP intercept
        this._unHttp = http.intercept("get", MESSAGE_URL_RE, function(req, send) {
            var resp = send(req);
            try {
                if (resp.body) {
                    var modified = false;
                    if (Array.isArray(resp.body)) {
                        for (var i = 0; i < resp.body.length; i++) {
                            if (patchMessage(resp.body[i])) modified = true;
                        }
                    } else if (resp.body.messages) {
                        for (var j = 0; j < resp.body.messages.length; j++) {
                            var group = resp.body.messages[j];
                            if (Array.isArray(group)) {
                                for (var k = 0; k < group.length; k++) {
                                    if (patchMessage(group[k])) modified = true;
                                }
                            }
                        }
                    }
                    if (modified) console.log(LOG, "Stripped explicit flags from HTTP response");
                }
            } catch (e) {
                console.error(LOG, "HTTP intercept error:", e);
            }
            return resp;
        });

        // Layer 2: Flux intercept
        this._unFlux = intercept(function(dispatch) {
            if (!dispatch || !dispatch.type) return;

            if (dispatch.type === "MESSAGE_CREATE" || dispatch.type === "MESSAGE_UPDATE") {
                if (dispatch.message && patchMessage(dispatch.message)) {
                    console.log(LOG, "Patched", dispatch.type, "dispatch");
                }
            }

            if (dispatch.type === "READY" || dispatch.type === "READY_SUPPLEMENTAL") {
                if (dispatch.user) {
                    dispatch.user.age_verification_status = 3;
                    console.log(LOG, "Patched age verification in", dispatch.type);
                }
            }
        });

        // Layer 3: Patch UserStore directly
        function patchUser() {
            try {
                var user = UserStore && UserStore.getCurrentUser && UserStore.getCurrentUser();
                if (user) user.ageVerificationStatus = 3;
            } catch (e) {}
        }
        patchUser();
        this._userInterval = setInterval(patchUser, 3000);

        // Layer 4: DOM fallback
        sweepDOM(document.body);

        this._domObserver = new MutationObserver(function(mutations) {
            for (var i = 0; i < mutations.length; i++) {
                var mutation = mutations[i];
                if (mutation.type === "childList") {
                    for (var j = 0; j < mutation.addedNodes.length; j++) {
                        var node = mutation.addedNodes[j];
                        if (node.nodeType === Node.ELEMENT_NODE) sweepDOM(node);
                    }
                } else if (mutation.type === "attributes" && mutation.target.nodeType === Node.ELEMENT_NODE) {
                    var el = mutation.target;
                    var cls = el.className;
                    if (typeof cls !== "string") continue;
                    if (cls.includes("explicitContentWarning") || cls.includes("obscureWarning")) {
                        el.style.display = "none";
                    }
                    if (cls.includes("spoilerContent")) stripClasses(el, SPOILER_STRIP);
                    if (cls.includes("obscured_") || cls.includes("hiddenExplicit_") || cls.includes("hiddenMosaicItem_")) {
                        stripClasses(el, IMAGE_STRIP);
                    }
                }
            }
        });

        this._domObserver.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["class"],
        });

        this._sweepInterval = setInterval(function() { sweepDOM(document.body); }, 2000);

        console.log(LOG, "All layers active");
    },

    onUnload() {
        if (this._unFlux) this._unFlux();
        if (this._unHttp) this._unHttp();
        if (this._domObserver) this._domObserver.disconnect();
        if (this._sweepInterval) clearInterval(this._sweepInterval);
        if (this._userInterval) clearInterval(this._userInterval);
        console.log("[NSFW Uncucker]", "Unloaded");
    }
})
