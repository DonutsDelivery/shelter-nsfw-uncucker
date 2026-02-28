const {
    flux: { intercept, storesFlat: { UserStore } },
    http,
    observeDom,
    plugin: { scoped },
    util: { log },
} = shelter;

const EXPLICIT_FLAG = 16;
const LOG = "[NSFW Uncucker]";
const MESSAGE_URL_RE = /\/api\/v\d+\/channels\/\d+\/messages/;

// ─── Helpers ─────────────────────────────────────────────────────

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

// ─── DOM helpers ─────────────────────────────────────────────────

const SPOILER_STRIP = ["opaque_", "hidden_", "constrainedObscureContent_"];
const IMAGE_STRIP = ["obscured_", "hiddenExplicit_", "hiddenMosaicItem_"];

function stripClasses(el, prefixes) {
    let stripped = false;
    for (const cls of [...el.classList]) {
        if (prefixes.some((p) => cls.startsWith(p))) {
            el.classList.remove(cls);
            stripped = true;
        }
    }
    return stripped;
}

function sweepDOM(root) {
    if (!root) return;
    root.querySelectorAll('[class*="explicitContentWarning"], [class*="obscureWarning"]').forEach((el) => {
        el.style.display = "none";
    });
    root.querySelectorAll('[class*="spoilerContent"]').forEach((el) => {
        stripClasses(el, SPOILER_STRIP);
    });
    root.querySelectorAll('[class*="obscured_"], [class*="hiddenExplicit_"], [class*="hiddenMosaicItem_"]').forEach((el) => {
        stripClasses(el, IMAGE_STRIP);
    });
}

// ─── State ───────────────────────────────────────────────────────

let domObserver = null;
let sweepInterval = null;
let userPatchInterval = null;
let uninterceptFlux = null;
let uninterceptHttp = null;

// ─── Plugin lifecycle ────────────────────────────────────────────

export function onLoad() {
    console.log(LOG, "Loading...");

    // Layer 1: HTTP intercept — strip explicit flags from message responses
    // and bypass X-Super-Properties by intercepting the request
    uninterceptHttp = http.intercept("get", MESSAGE_URL_RE, (req, send) => {
        const resp = send(req);
        try {
            if (resp.body) {
                let modified = false;
                if (Array.isArray(resp.body)) {
                    for (const msg of resp.body) {
                        if (patchMessage(msg)) modified = true;
                    }
                } else if (resp.body.messages) {
                    for (const group of resp.body.messages) {
                        if (Array.isArray(group)) {
                            for (const msg of group) {
                                if (patchMessage(msg)) modified = true;
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

    // Layer 2: Flux intercept — patch dispatches for messages and READY
    uninterceptFlux = intercept((dispatch) => {
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
            const user = UserStore?.getCurrentUser?.();
            if (user) {
                user.ageVerificationStatus = 3;
            }
        } catch {}
    }
    patchUser();
    userPatchInterval = setInterval(patchUser, 3000);

    // Layer 4: DOM fallback — observe and clean up content warnings
    sweepDOM(document.body);

    domObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === "childList") {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) sweepDOM(node);
                }
            } else if (mutation.type === "attributes" && mutation.target.nodeType === Node.ELEMENT_NODE) {
                const el = mutation.target;
                const cls = el.className;
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

    domObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class"],
    });

    sweepInterval = setInterval(() => sweepDOM(document.body), 2000);

    console.log(LOG, "All layers active");
}

export function onUnload() {
    if (uninterceptFlux) uninterceptFlux();
    if (uninterceptHttp) uninterceptHttp();
    if (domObserver) domObserver.disconnect();
    if (sweepInterval) clearInterval(sweepInterval);
    if (userPatchInterval) clearInterval(userPatchInterval);
    console.log(LOG, "Unloaded");
}
